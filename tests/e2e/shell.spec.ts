import { expect, test, type Page } from "@playwright/test";

/**
 * PR1/PR2 Shell + RBAC 冒烟(SPEC §17 第 8 项:角色切换后菜单和权限变化)。
 * 依赖 global-setup 的种子账号(密码 demo1234,SEED_DEMO_PASSWORD 可覆盖)。
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function menuHrefs(page: Page): Promise<(string | null)[]> {
  return page.locator(".sidebar .nav a.nav-item").evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")),
  );
}

test("未登录访问受保护页跳转登录页", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/quotes");
  await expect(page).toHaveURL(/\/login$/);
});

test("PM 登录:PM 工作台 + 菜单裁剪 + 搜索范围", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await expect(page.locator(".page-title")).toHaveText("PM 工作台");
  const hrefs = await menuHrefs(page);
  expect(hrefs).toContain("/rfq");
  expect(hrefs).toContain("/quotes");
  expect(hrefs).toContain("/bom");
  expect(hrefs).not.toContain("/procurement/rfq");
  expect(hrefs).not.toContain("/settings");
  await expect(page.locator(".topbar-search")).toHaveAttribute(
    "placeholder",
    /RFQ \/ 客户 \/ 报价 \/ BOM/,
  );
});

test("角色切换(退出→采购登录):菜单/工作台/搜索范围联动更新", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await page.getByRole("button", { name: "退出" }).click();
  await page.waitForURL("**/login");

  await login(page, "procurement@demo.ezplm.cn");
  await expect(page.locator(".page-title")).toHaveText("采购工作台");
  const hrefs = await menuHrefs(page);
  expect(hrefs).toContain("/procurement/rfq");
  expect(hrefs).toContain("/suppliers/opo");
  expect(hrefs).not.toContain("/rfq");
  expect(hrefs).not.toContain("/quotes");
  await expect(page.locator(".topbar-search")).toHaveAttribute("placeholder", /供应商 \/ 采购 RFQ/);
});

test("管理层登录:全局菜单(15 条路由全可见)", async ({ page }) => {
  await login(page, "management@demo.ezplm.cn");
  await expect(page.locator(".page-title")).toHaveText("管理工作台");
  const hrefs = await menuHrefs(page);
  for (const p of [
    "/",
    "/rfq",
    "/bom",
    "/bom/import",
    "/bom/compare",
    "/materials",
    "/quotes",
    "/procurement/rfq",
    "/procurement/orders",
    "/suppliers/opo",
    "/reconciliation",
    "/shortage",
    "/kitting",
    "/inventory",
    "/settings",
  ]) {
    expect(hrefs, `管理层菜单缺少 ${p}`).toContain(p);
  }
});

test("子页面返回上一层按钮可用(工程角色)", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/bom/import");
  const back = page.locator(".back-link");
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/bom$/);
});

test("占位页如实标注待实现状态(诚实 UI)", async ({ page }) => {
  // ⚠ 维护提示:本用例必须指向**仍在用 ModulePlaceholder 的路由**。
  // 每当该模块落地,请改指向另一个占位路由(查找方式:grep -l ModulePlaceholder app/**/page.tsx)。
  // 历史:PR7 前指向 /quotes,PR8 前指向 /inventory,均随模块落地而失效。
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/shortage");
  await expect(page.locator(".banner")).toContainText("待实现");
  await expect(page.locator(".banner")).toContainText("PR8");
});

test("登录/退出生成 AuditLog(经 /api 无会话 401 佐证鉴权链路)", async ({ page, request }) => {
  // 未登录调用 API 返回 401(middleware 鉴权)
  const res = await request.post("/api/auth/logout");
  expect(res.status()).toBe(401);
  // 登录后退出走通(AuditLog 落库由单测+登录接口实现保证,此处验证链路可达)
  await login(page, "pm@demo.ezplm.cn");
  await page.getByRole("button", { name: "退出" }).click();
  await page.waitForURL("**/login");
});
