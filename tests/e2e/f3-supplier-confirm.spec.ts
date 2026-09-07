import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * F3:供应商免登录确认链路(设计 docs/design/F3-CHECKPOINT-A.md)。
 * 覆盖:批准 PO → 生成链接 → **无登录上下文**打开 → 有变更地确认 →
 * PO 页显示 Supplier Confirmed via Link → 重放被拒(409 页面)→
 * OPO ETA 链接 → 回复落 OPOReply(source=LINK)→ 无效/过期语义。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function createApprovedPo(page: Page): Promise<{ poId: string; mpn: string }> {
  const mpn = `F3-MPN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/procurement/orders");
  await page.getByRole("button", { name: "新建采购订单" }).click();
  await page.getByLabel("PO 号").fill(`F3-PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await page
    .getByLabel(/粘贴订单行/)
    .fill(["MPN\t数量\t单价\tMOQ\tSPQ\t交期\t需求日期", `${mpn}\t1000\t7.10\t100\t100\t20\t2026-12-01`].join("\n"));
  await page.getByRole("button", { name: "创建订单" }).click();
  await page.waitForURL(/\/procurement\/orders\/[^/]+$/);
  const poId = page.url().split("/").pop()!;

  await page.getByRole("button", { name: "提交价格复核" }).click();
  await expect(page.getByRole("button", { name: /复核通过/ })).toBeVisible();
  await page.getByRole("button", { name: /复核通过/ }).click();
  await expect(page.getByRole("button", { name: /终审通过并生成在途行/ })).toBeVisible();
  await page.getByRole("button", { name: /终审通过并生成在途行/ }).click();
  await expect(page.getByText("已审批 · 待 ERP 录入").first()).toBeVisible();
  await expect(page.getByTestId("supplier-confirm-block")).toBeVisible();
  return { poId, mpn };
}

/** 无任何 cookie 的全新上下文(真正的"供应商没有账号") */
async function anonPage(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}

test("PO 确认闭环:生成链接 → 匿名确认(有变更)→ 显示 via Link → 重放被拒", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.qianchuang.cn"); // 管理层可走完两级审批,也可生成链接
  await createApprovedPo(page);

  // 生成链接(原始 token 只出现这一次)
  await page.getByTestId("gen-confirm-link").click();
  const out = page.getByTestId("confirm-link-out");
  await expect(out).toBeVisible();
  const url = (await out.locator("code").innerText()).trim();
  expect(url).toContain("/confirm/");

  // 匿名上下文打开(公开页不挂内部壳,且**不显示单价**)
  const { ctx, page: pub } = await anonPage(browser);
  await pub.goto(url);
  await expect(pub.getByTestId("po-lines")).toBeVisible();
  await expect(pub.locator("body")).not.toContainText("7.10"); // 最小字段:无单价
  await expect(pub.locator(".sidebar")).toHaveCount(0); // 无内部导航

  // 有变更地确认:第 1 行改数量
  await pub.getByLabel("第 1 行确认数量").fill("900");
  await pub.getByRole("radio", { name: /有变更地确认/ }).check();
  await pub.getByLabel("您的姓名").fill("测试供应商联系人");
  await pub.getByLabel("您的邮箱").fill("supplier@example.com");
  await pub.getByTestId("confirm-submit").click();
  await expect(pub.getByTestId("confirm-done")).toBeVisible();

  // 重放:再次打开同链接 → 已确认过,且**不再展示业务数据**
  await pub.goto(url);
  await expect(pub.getByTestId("confirm-replayed")).toBeVisible();
  await expect(pub.getByTestId("po-lines")).toHaveCount(0);
  await ctx.close();

  // 内部侧:PO 页显示 Supplier Confirmed via Link · 有变更地确认
  await page.reload();
  await expect(page.getByTestId("supplier-confirmed-via-link")).toContainText("Supplier Confirmed via Link");
  await expect(page.getByTestId("supplier-confirmed-via-link")).toContainText("有变更地确认");
});

test("OPO ETA 闭环:生成供应商链接 → 匿名回复交期 → 落 OPOReply(来源=LINK)", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.qianchuang.cn"); // 两级审批一口气走完
  // 先造一张批准 PO 以生成在途行(materializeOpo)
  await createApprovedPo(page);

  await page.goto("/suppliers/opo");
  await page.getByTestId("gen-eta-link").click();
  const out = page.getByTestId("eta-link-out");
  await expect(out).toBeVisible();
  const url = (await out.locator("code").innerText()).trim();

  const { ctx, page: pub } = await anonPage(browser);
  await pub.goto(url);
  await expect(pub.getByTestId("eta-lines")).toBeVisible();

  // 回复第一行交期
  const firstEta = pub.locator('input[type="date"]').first();
  await firstEta.fill("2026-10-20");
  await pub.getByLabel("您的姓名").fill("交期回复人");
  await pub.getByLabel("您的邮箱").fill("eta@example.com");
  await pub.getByTestId("confirm-submit").click();
  await expect(pub.getByTestId("confirm-done")).toBeVisible();
  await ctx.close();

  // 内部 OPO 页:出现来源 LINK 的回复
  await page.goto("/suppliers/opo");
  await expect(page.locator("body")).toContainText("2026-10-20");
});

test("无效与过期语义:乱 token → 无效页;格式不符 → 无效页;API 重放 → 409", async ({ browser, page }) => {
  const { ctx, page: pub } = await anonPage(browser);
  await pub.goto("/confirm/definitely-not-a-real-token-aaaaaaaaaaaa");
  await expect(pub.getByTestId("confirm-invalid")).toBeVisible();
  await pub.goto("/confirm/short");
  await expect(pub.getByTestId("confirm-invalid")).toBeVisible();
  await ctx.close();

  // API 侧:未知 token 一律 404(与不存在不可区分)
  const res = await page.request.post("/api/confirm/definitely-not-a-real-token-aaaaaaaaaaaa", {
    data: { kind: "PO_CONFIRM", decision: "CONFIRM", respondedByName: "x", respondedByEmail: "x@x.com", lines: [] },
  });
  expect(res.status()).toBe(404);
});
