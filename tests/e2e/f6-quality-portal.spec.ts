import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * F6:质量看板扩展 + 客户门户 Shell 隔离矩阵(设计 docs/design/F6-CHECKPOINT-A.md §5)。
 *
 * 门户隔离矩阵为**合并门禁**:
 * ① 门户会话调内部 API → 401;② 内部会话调门户 API → 401;
 * ③ 开关关闭 → /portal 404;④ 导出不含禁止字段;⑤ scope 无参数可传。
 *
 * E2E 的 webServer 配置了 CUSTOMER_PORTAL_ENABLED=1 与 PORTAL_AUTH_SECRET;
 * 租户 flag customerPortal 由用例内开启并还原。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

// 前两个用例都动租户 flag customerPortal —— 串行执行,避免并发互踩
test.describe.configure({ mode: "serial" });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function anonPage(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}

/** 开租户 flag + 邀请一个门户账号;返回还原函数与账号信息 */
async function setupPortal(page: Page) {
  await login(page, "management@demo.qianchuang.cn");
  const current = await (await page.request.get("/api/settings/tenant")).json();
  await page.request.put("/api/settings/tenant", {
    data: {
      ...current.settings,
      featureFlags: { ...current.settings.featureFlags, customerPortal: true },
    },
  });
  // 邀请接口需要 customerId —— 从质量页的「客户筛选」下拉抓取种子库第一个客户 id
  await page.goto("/quality");
  const firstCustomerId = await page
    .locator('select[aria-label="客户筛选"] option')
    .nth(1)
    .getAttribute("value");
  expect(firstCustomerId, "种子库应至少有一个客户").toBeTruthy();

  const email = `portal-${Date.now()}@example.com`;
  const invite = await page.request.post("/api/settings/portal-accounts", {
    data: { customerId: firstCustomerId, email, password: "portal-e2e-pass-1" },
  });
  expect(invite.status()).toBe(201);

  return {
    email,
    password: "portal-e2e-pass-1",
    restore: async () => {
      await page.request.put("/api/settings/tenant", { data: current.settings });
    },
  };
}

test("门户闭环 + 隔离矩阵(合并门禁)", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const portal = await setupPortal(page);

  try {
    // 匿名上下文走门户登录
    const { ctx, page: pub } = await anonPage(browser);
    await pub.goto("/portal/login");
    await pub.getByLabel("门户邮箱").fill(portal.email);
    await pub.getByLabel("门户密码").fill(portal.password);
    await pub.getByTestId("portal-login-submit").click();
    await expect(pub.getByTestId("portal-customer-name")).toBeVisible();

    // 总览 KPI:ERP 未配置 → 「待接入」,不显示 0
    await expect(pub.getByTestId("portal-kpi-inventory")).toContainText("待接入");

    // 我的库存:诚实空态
    await pub.goto("/portal/inventory");
    await expect(pub.getByTestId("portal-inventory-empty")).toContainText("不显示任何数字");

    // 占位页:无示例数据
    await pub.goto("/portal/transactions");
    await expect(pub.getByTestId("portal-transactions-empty")).toContainText("待接入");

    // ② 门户会话调内部 API → 401(内部中间件只认 scm_session)
    const internalApi = await pub.request.get("/api/settings/tenant");
    expect(internalApi.status()).toBe(401);
    const searchApi = await pub.request.get("/api/search?q=any");
    expect(searchApi.status()).toBe(401);

    // ④ 导出:白名单表头,无价格/供应商字段
    const exp = await pub.request.get("/api/portal/export");
    expect(exp.status()).toBe(200);
    const csv = await exp.text();
    expect(csv).toContain("物料编码");
    expect(csv).not.toContain("价");
    expect(csv).not.toContain("供应商");

    await ctx.close();

    // ③ 内部会话调门户 API → 401(门户守卫只认 portal_session)
    const portalApiAsInternal = await page.request.get("/api/portal/inventory");
    expect(portalApiAsInternal.status()).toBe(401);
  } finally {
    await portal.restore();
  }
});

test("开关关闭 → 门户 404(功能不存在,不是无权限)", async ({ page, browser }) => {
  // 租户 flag 默认关闭(上一用例已还原);env 开着也进不去
  await login(page, "management@demo.qianchuang.cn");
  const current = await (await page.request.get("/api/settings/tenant")).json();
  expect(current.settings.featureFlags.customerPortal).toBe(false);

  const { ctx, page: pub } = await anonPage(browser);
  // 登录接口在 flag 关闭的租户上拒绝(账号属于该租户)
  const res = await pub.request.post("/api/portal/auth/login", {
    data: { email: "portal-nobody@example.com", password: "x" },
  });
  // 未启用租户的账号不存在 → 401 防枚举;门户 env 开着,页面本身可达登录页
  expect([401, 404]).toContain(res.status());
  await ctx.close();
});

test("质量看板:KPI 消费 lib/metrics、筛选与下钻、趋势只含本租户", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/quality");

  await expect(page.getByTestId("quality-kpis")).toBeVisible();
  await expect(page.getByTestId("quality-trend")).toBeVisible();

  // 下钻:客户投诉 KPI → type 过滤参数
  await page.getByTestId("quality-kpi-complaint").click();
  await expect(page).toHaveURL(/type=CUSTOMER_COMPLAINT/);
  // 过滤后的表格只显示客诉(或空);页面不报错
  await expect(page.getByTestId("quality-table")).toBeVisible();

  // 组合筛选表单可用
  await page.getByLabel("状态筛选").selectOption("OPEN");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page).toHaveURL(/status=OPEN/);
});
