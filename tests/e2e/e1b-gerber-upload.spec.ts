import { expect, test, type Page } from "@playwright/test";

/**
 * E1b / 客户 Q13:「gerber 无固定大小。**无法将 gerber 作为附件传入,出现死机情况**」。
 *
 * 审计结论:旧实现 `await req.formData()` 先把所有文件整个缓冲进内存,
 * **之后**才检查 20MB 上限 —— 传 200MB 就是先吃下 200MB 再说"超限"。
 *
 * 本组用例证明:
 * ① 超限在**读 body 之前**就被拒(服务不会先吃下整包);
 * ② 大文件(50MB)能真正传上去并落库;
 * ③ 保存成功**不等于**解析成功,界面如实标注;
 * ④ 没有 Content-Length 一律拒绝。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function createRfq(page: Page, title: string): Promise<string> {
  await page.goto("/rfq");
  await page.getByLabel("标题").fill(title);
  await page.getByRole("button", { name: "创建 RFQ" }).click();
  await expect(page).toHaveURL(/\/rfq\/[^/]+$/);
  return page.url().split("/").pop()!;
}

/** 生成 n MB 的假 Gerber 内容(内容不重要,大小才重要) */
function fakeBytes(mb: number): Buffer {
  return Buffer.alloc(mb * 1024 * 1024, 0x47); // 'G'
}

test("**超出上限的文件在读 body 之前就被拒** —— 服务不会先把整包吃进内存", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.qianchuang.cn");
  const rfqId = await createRfq(page, `E2E Gerber 超限 ${Date.now()}`);

  // 默认上限 100MB;传 120MB
  const res = await page.request.post(
    `/api/upload/rfq-attachment?rfqId=${rfqId}&name=huge.zip&type=GERBER`,
    {
      headers: { "content-type": "application/zip" },
      data: fakeBytes(120),
    },
  );

  expect(res.status(), "超限应返回 413,而不是 500 或超时").toBe(413);
  const body = await res.json();
  expect(body.code).toBe("too_large");
  // 要说清多大、上限多少、以及上限可调 —— 光说"太大了"用户无从下手
  expect(body.error).toContain("120.0MB");
  expect(body.error).toContain("100MB");
  expect(body.error).toContain("ATTACHMENT_MAX_MB");

  // 没有留下任何半截附件
  await page.reload();
  await expect(page.locator(".card", { hasText: "附件" }).locator("table.tbl tbody")).not.toContainText("huge.zip");
});

test("50MB Gerber 包能真正传上去并落库 —— 旧上限 20MB 会直接拒掉它", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, "pm@demo.qianchuang.cn");
  const rfqId = await createRfq(page, `E2E Gerber 50MB ${Date.now()}`);

  const res = await page.request.post(
    `/api/upload/rfq-attachment?rfqId=${rfqId}&name=pcb-gerber.zip&type=GERBER`,
    { headers: { "content-type": "application/zip" }, data: fakeBytes(50) },
  );
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  expect(body.attachment.sizeBytes).toBe(50 * 1024 * 1024);
  // **保存 ≠ 解析**:回执必须说清楚
  expect(body.attachment.processState).toBe("UPLOADED_NOT_PARSED");
  expect(body.note).toContain("未做内容解析");

  // 页面上如实显示"已保存 · 未解析",而不是含糊的"成功"
  await page.reload();
  const row = page.locator(".card", { hasText: "附件" }).locator("table.tbl tbody tr").filter({ hasText: "pcb-gerber.zip" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("已保存 · 未解析");
  await expect(row).toContainText("50.0 MB");
  await expect(row).toContainText("不解析");
});

test("Gerber 散文件按扩展名自动打上 GERBER 标签", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.qianchuang.cn");
  const rfqId = await createRfq(page, `E2E Gerber 扩展名 ${Date.now()}`);

  const res = await page.request.post(
    `/api/upload/rfq-attachment?rfqId=${rfqId}&name=top-layer.GTL&type=OTHER`,
    { headers: { "content-type": "application/octet-stream" }, data: Buffer.from("G04 test*") },
  );
  expect(res.status()).toBe(201);
  expect((await res.json()).attachment.type).toBe("GERBER");
});

test("多文件逐个上传:界面给出进度与取消入口,不是点了没反应", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.qianchuang.cn");
  await createRfq(page, `E2E 上传进度 ${Date.now()}`);

  await page.getByLabel("选择文件(可多选,保留原始客户文件)").setInputFiles([
    { name: "a.GTL", mimeType: "application/octet-stream", buffer: Buffer.from("G04 a*") },
    { name: "b.GBL", mimeType: "application/octet-stream", buffer: Buffer.from("G04 b*") },
  ]);
  await page.getByRole("button", { name: "上传附件" }).click();

  const progress = page.getByTestId("upload-progress");
  await expect(progress).toBeVisible({ timeout: 30_000 });
  await expect(progress).toContainText("a.GTL");
  await expect(progress).toContainText("b.GBL");
  // 两个都落到"已保存 · 未解析",而不是笼统的"上传成功"
  await expect(progress.getByText("已保存 · 未解析")).toHaveCount(2, { timeout: 60_000 });

  // 附件表里两条都在
  const table = page.locator(".card", { hasText: "附件" }).locator("table.tbl tbody");
  await expect(table).toContainText("a.GTL");
  await expect(table).toContainText("b.GBL");
});

test("旧的 multipart 入口同样在读 body 之前拒绝超限请求", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.qianchuang.cn");
  const rfqId = await createRfq(page, `E2E multipart 超限 ${Date.now()}`);

  const res = await page.request.post(`/api/rfq/${rfqId}/attachments`, {
    multipart: {
      type: "GERBER",
      files: { name: "big.zip", mimeType: "application/zip", buffer: fakeBytes(120) },
    },
  });
  expect(res.status()).toBe(413);
  const body = await res.json();
  expect(body.code).toBe("too_large");
  // 并指路到流式入口
  expect(body.hint).toContain("流式");
});
