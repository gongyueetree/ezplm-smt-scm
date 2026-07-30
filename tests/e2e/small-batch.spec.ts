import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * 小件打包 E2E —— 四项都是客户原话点名"缺按钮/缺入口"的:
 * 1. BOM→报价转化按钮(客户:「有,但是没有嵌入BOM 模块转化的按钮」);
 * 2. 标准模板 BOM 一键导出(客户:「无导出button」);
 * 3. BOM 比对历史台账(客户:「每次比对需要重新选择版本,历史快照留存」);
 * 4. 物料二级分类与自定义标签(客户:「仅一级大类…无二级细分」「无自定义物料分类标签」)。
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";
const BOM_FIXTURE = path.join(__dirname, "fixtures", "demo-bom.csv");
/** 比对专用:两份内容确有差异的 BOM(同一文件二次导入会被幂等复用,构造不出两版) */
const CMP_V1 = path.join(__dirname, "fixtures", "compare-bom-v1.csv");
const CMP_V2 = path.join(__dirname, "fixtures", "compare-bom-v2.csv");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/** 自建 BOM 版本并锁定 id —— 不依赖库里正好有哪一版 */
async function importBom(page: Page, fixture: string = BOM_FIXTURE): Promise<string> {
  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles(fixture);
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });
  const href = await page
    .getByRole("link", { name: /进入匹配确认/ })
    .first()
    .getAttribute("href");
  const id = href?.split("/").pop();
  expect(id, "导入后应拿到 BOM 版本 id").toBeTruthy();
  return id!;
}

test("BOM 版本页有「导出标准模板 BOM」按钮,导出的是 xlsx", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.ezplm.cn");
  const versionId = await importBom(page);
  await page.goto(`/bom/version/${versionId}`);

  const link = page.getByRole("link", { name: "导出标准模板 BOM" });
  await expect(link).toBeVisible();
  const download = page.waitForEvent("download");
  await link.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^bom-.*\.xlsx$/);
});

test("BOM 版本页有「生成报价单」按钮;未挂 RFQ/客户时给出可操作的拒绝理由", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.ezplm.cn");
  const versionId = await importBom(page);
  await page.goto(`/bom/version/${versionId}`);

  const btn = page.getByRole("button", { name: "生成报价单" });
  await expect(btn).toBeVisible();
  await btn.click();

  // 两种结果都是合法的:成功跳报价页,或因缺 RFQ/客户、无已确认行而被明确拒绝。
  // 关键是**不能静默无反应**。
  await expect
    .poll(
      async () =>
        (await page.getByTestId("bom-action-error").count()) +
        (page.url().includes("/quotes/") ? 1 : 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  if (!page.url().includes("/quotes/")) {
    const err = page.getByTestId("bom-action-error");
    // 拒绝理由必须说清下一步怎么做
    await expect(err).toContainText(/未关联 RFQ 或客户|没有已人工确认的匹配行/);
  }
});

test("BOM 比对:可保存到台账,台账能一键重新打开同一对版本", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.ezplm.cn");
  const v1 = await importBom(page, CMP_V1);
  const v2 = await importBom(page, CMP_V2);
  expect(v1, "两份内容不同的 BOM 必须产出两个不同版本").not.toBe(v2);

  await page.goto(`/bom/compare?from=${v1}&to=${v2}`);
  // 直接断按钮而不是断卡片标题:「本次比对」这个词在页面上不止一处,
  // 用它做定位会同时匹配到多个卡片
  const saveBtn = page.getByRole("button", { name: "保存本次比对到台账" });
  await expect(saveBtn).toBeVisible();
  await expect(page.getByText("差异明细")).toBeVisible();

  await saveBtn.click();
  await expect(page.getByRole("button", { name: "已存入台账" })).toBeVisible({ timeout: 30_000 });

  // 台账里应能一键回到同一对版本(客户抱怨的正是"每次都要重新选版本")
  const ledger = page.locator(".card", { hasText: "历史比对台账" });
  await expect(ledger).toBeVisible();
  const reopen = ledger.getByRole("link", { name: "重新打开" }).first();
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page).toHaveURL(new RegExp(`from=${v1}&to=${v2}`));
});

test("物料查询:一级大类 / 二级细分 / 自定义标签可组合筛选,且标注分类为人工维护", async ({
  page,
}) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/materials");

  await expect(page.getByLabel("一级大类")).toBeVisible();
  await expect(page.getByLabel("二级细分")).toBeVisible();
  await expect(page.getByLabel("自定义标签")).toBeVisible();
  // 诚实标注:分类是本地人工维护,ezPLM 只作建议来源
  await expect(page.getByText(/分类为本地人工维护/)).toBeVisible();
  await expect(page.getByText(/猜错的分类会一路带偏/)).toBeVisible();

  // 组合筛选:关键字 + 一级大类同时生效(URL 带上两者)
  await page.getByLabel(/关键字/).fill("STM32");
  await page.getByLabel("一级大类").selectOption("IC");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page).toHaveURL(/q=STM32/);
  await expect(page).toHaveURL(/l1=IC/);

  // 结果表有「分类 / 标签」列;未分类的行如实写"未分类"而不是留空
  await expect(page.getByRole("columnheader", { name: "分类 / 标签" })).toBeVisible();
});

test("自定义标签目录:可新建,重名被拒", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  const name = `E2E标签-${Date.now()}`;

  // 必须用 page.request:Playwright 的 request fixture 是**独立上下文**,不带页面的会话 cookie,
  // 直接用它会拿到 401 而不是业务结果
  const ok = await page.request.post("/api/materials/tags", { data: { name } });
  expect(ok.status()).toBe(201);

  const dup = await page.request.post("/api/materials/tags", { data: { name } });
  expect(dup.status()).toBe(400);
  expect(await dup.text()).toContain("同名标签已存在");

  await page.goto("/materials");
  await expect(page.getByLabel("自定义标签").locator(`option:has-text("${name}")`)).toHaveCount(1);
});
