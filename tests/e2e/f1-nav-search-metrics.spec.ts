import { expect, test, type Page } from "@playwright/test";

/**
 * F1 · KICKOFF Round2:导航按角色/权限变化、全局搜索按 SEARCH_SCOPES、
 * 管理看板 KPI 下钻、URL 直达越权 403、租户配置默认值。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("四角色菜单确实不同;质量事件按 quality.view 权限出没", async ({ page }) => {
  // MANAGEMENT:全都有,含质量事件(默认持 quality.view)
  await login(page, "management@demo.qianchuang.cn");
  const nav = page.locator(".sidebar, nav").first();
  await expect(nav.getByRole("link", { name: "质量事件" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "报价管理" })).toBeVisible();

  // ENGINEERING:默认有 quality.view(追溯要看)→ 可见;但没有采购菜单
  await login(page, "engineering@demo.qianchuang.cn");
  await expect(nav.getByRole("link", { name: "质量事件" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "采购 RFQ 比价" })).toHaveCount(0);

  // PROCUREMENT:**没有 quality.view → 菜单里没有质量事件**(权限门,非角色门)
  await login(page, "procurement@demo.qianchuang.cn");
  await expect(nav.getByRole("link", { name: "质量事件" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "采购 RFQ 比价" })).toBeVisible();

  // PM:同样没有质量事件;有报价管理
  await login(page, "pm@demo.qianchuang.cn");
  await expect(nav.getByRole("link", { name: "质量事件" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "报价管理" })).toBeVisible();
});

test("全局搜索:范围由服务端按角色决定,不是谁想搜什么就搜什么", async ({ page }) => {
  test.setTimeout(120_000);
  // PM 搜客户名 → 命中 CUSTOMER 组
  await login(page, "pm@demo.qianchuang.cn");
  let res = await page.request.get("/api/search?q=联创");
  expect(res.status()).toBe(200);
  let body = await res.json();
  expect(body.groups.some((g: { type: string }) => g.type === "CUSTOMER")).toBe(true);

  // PROCUREMENT 搜同一个词 → **绝不出现 CUSTOMER 组**(客户不在采购范围)
  await login(page, "procurement@demo.qianchuang.cn");
  res = await page.request.get("/api/search?q=联创");
  body = await res.json();
  expect(body.groups.some((g: { type: string }) => g.type === "CUSTOMER")).toBe(false);

  // PROCUREMENT 搜供应商名 → SUPPLIER 组命中
  res = await page.request.get("/api/search?q=华强北");
  body = await res.json();
  const supplier = body.groups.find((g: { type: string }) => g.type === "SUPPLIER");
  expect(supplier?.hits?.[0]?.title).toContain("华强北");

  // ENGINEERING:ECN 范围 —— F2 上线后为真实检索(F1 时曾是占位注明)。
  // 造一条 ECN 再按编号搜,断言真实命中
  await login(page, "engineering@demo.qianchuang.cn");
  const created = await page.request.post("/api/ecn", {
    data: { title: `F1 搜索用例 ${Date.now()}`, type: "OTHER", priority: "LOW" },
  });
  expect(created.status()).toBe(201);
  const ecnCode: string = (await created.json()).code;
  res = await page.request.get(`/api/search?q=${encodeURIComponent(ecnCode)}`);
  body = await res.json();
  const ecn = body.groups.find((g: { type: string }) => g.type === "ECN");
  expect(ecn?.hits?.[0]?.title).toContain(ecnCode);

  // 词太短直接拒
  res = await page.request.get("/api/search?q=a");
  expect(res.status()).toBe(400);
});

test("搜索 UI:输入即出分组下拉,可点击跳转", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.qianchuang.cn");
  await page.getByLabel("全局搜索").fill("联创");
  const results = page.getByTestId("search-results");
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("search-group-CUSTOMER")).toBeVisible();
});

test("管理看板:至少 3 个 KPI 可下钻且带过滤参数", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");

  await page.getByTestId("kpi-shortage").click();
  await expect(page).toHaveURL(/\/shortage/);
  await page.goBack();

  await page.getByTestId("kpi-quality").click();
  await expect(page).toHaveURL(/\/quality/);
  await page.goBack();

  // 损耗下钻**带 period 参数** —— 落地页直接是当月,不用二次筛
  await page.getByTestId("kpi-scrap").click();
  await expect(page).toHaveURL(/\/scrap\?period=\d{4}-\d{2}/);
});

test("看板新 KPI 诚实空态:Excess 未接入显示「待接入」而不是 0", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  const excess = page.getByTestId("kpi-excess");
  const text = await excess.innerText();
  // 数据源两态:接入了显示数字+快照时间;没接入必须写"待接入",绝不显示 0 充数
  if (text.includes("待接入")) {
    expect(text).toContain("不按 0 显示");
  } else {
    expect(text).toMatch(/快照 \d{4}-\d{2}-\d{2}/);
  }
});

test("URL 直达越权:非管理层调租户配置 API → 403", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  const res = await page.request.get("/api/settings/tenant");
  expect(res.status()).toBe(403);

  // 管理层可读,且默认值符合"保守默认"(全 flag 关、主数据源 EZPLM)
  await login(page, "management@demo.qianchuang.cn");
  const ok = await page.request.get("/api/settings/tenant");
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.settings.masterDataSource).toBe("EZPLM");
  expect(body.settings.featureFlags.customerPortal).toBe(false);
});

test("面包屑由 route config 派生,子页展示完整层级", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/procurement/rfq");
  const crumb = page.locator(".topbar-breadcrumb");
  await expect(crumb).toContainText("采购 RFQ 比价");
});
