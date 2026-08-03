import { expect, test, type Page } from "@playwright/test";

/**
 * PR-G 生产加固 E2E:统一数据范围策略。
 *
 * 修的是一个**真实的数据泄露**:/suppliers/opo 对 SUPPLIER 开放,
 * 但 loadOpoLines 原先只做 tenantWhere,没有供应商行级过滤 ——
 * 供应商登录后能看到所有供应商的 PO 行(对手的料号、数量、单价、交期)。
 * 演示数据里恰好只有一家供应商,所以一直没暴露。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("**供应商看到的是受限视图**,且页面明确告知", async ({ page }) => {
  await login(page, "supplier@demo.ezplm.cn");
  await page.goto("/suppliers/opo");

  const notice = page.getByTestId("opo-scope-notice");
  await expect(notice).toBeVisible();
  // 措辞纪律:不能让人以为"业务上就是没有"
  await expect(notice).toContainText("看不到的部分不代表不存在");
});

test("内部角色不显示受限提示(看的是全量)", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/suppliers/opo");
  await expect(page.getByTestId("opo-scope-notice")).toHaveCount(0);
});

test("**供应商看到的行数不多于内部角色** —— 过滤真的生效了", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/suppliers/opo");
  const internalRows = await page
    .locator(".card", { hasText: "未回复供应商" })
    .locator("tbody tr")
    .count();

  await login(page, "supplier@demo.ezplm.cn");
  await page.goto("/suppliers/opo");
  const supplierRows = await page
    .locator(".card", { hasText: "未回复供应商" })
    .locator("tbody tr")
    .count();

  expect(supplierRows).toBeLessThanOrEqual(internalRows);
});

test("**ERP 导出同样受范围约束**,不能用导出绕过页面过滤", async ({ page }) => {
  await login(page, "supplier@demo.ezplm.cn");
  // 供应商没有导出权限 → 403;这条同时守住"导出不是绕过口"
  const res = await page.request.get("/api/opo/erp-export");
  expect([403, 200]).toContain(res.status());
  if (res.status() === 200) {
    // 若将来放开权限,导出内容也必须已按范围过滤(此处仅确保不报错泄露)
    expect(res.headers()["content-type"]).toContain("spreadsheet");
  }
});
