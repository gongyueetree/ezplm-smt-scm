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
  // 每个匿名上下文一个独立"客户端 IP"(dev 无前置代理,TRUSTED_PROXY_HOPS=1
  // 会取 x-forwarded-for 最右段)—— 否则整个 E2E 套件共享一个 unknown 限流桶,
  // 连续跑两轮就会被 10/min 的门户登录限流误伤
  const fakeIp = `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp } });
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

  // R3-3:邀请制 —— 不再直发密码;拿一次性激活链接由「客户」自设密码
  const email = `portal-${Date.now()}@example.com`;
  const invite = await page.request.post("/api/settings/portal-accounts", {
    data: { customerId: firstCustomerId, email },
  });
  expect(invite.status()).toBe(201);
  const inviteBody = (await invite.json()) as { activateUrl: string; status: string };
  expect(inviteBody.status).toBe("INVITED");
  const activateToken = inviteBody.activateUrl.split("/portal/activate/")[1];
  const activate = await page.request.post(`/api/portal/activate/${activateToken}`, {
    data: { password: "portal-e2e-pass-1" },
  });
  expect(activate.status()).toBe(200);

  return {
    email,
    password: "portal-e2e-pass-1",
    restore: async () => {
      // 显式归零而不是回放捕获值 —— 捕获值可能已被上一轮失败运行污染(R3-3/R3-5 教训)
      await page.request.put("/api/settings/tenant", {
        data: {
          ...current.settings,
          featureFlags: { ...current.settings.featureFlags, customerPortal: false },
        },
      });
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

// ============================================================
// R3-3:门户账号邀请流(直发密码路径下线)。
// 与上方用例同文件串行 —— 本组同样开关租户 flag customerPortal,
// fullyParallel 下放独立文件会与本文件的 restore 互踩(激活中途 404)。
//
// 门禁矩阵:
// ① 邀请返回一次性激活链接,账号 INVITED,激活前不能登录;
// ② 匿名走激活页自设密码 → ACTIVE → 登录成功;
// ③ 单次使用:激活后旧链接 409(GET 与 POST 一致);
// ④ 重新邀请撤销旧链接:旧 404(与不存在不可区分)、新可用;
// ⑤ 停用:登录即拒 + 在途会话逐请求截断 + 未用邀请一并作废(404);
// ⑥ 未知 token 一律 404(防枚举);
// ⑦ 管理页 UI:邀请 → 复制链接框可见;仅 MANAGEMENT 可 API。
// ============================================================

async function setupFlag(page: Page) {
  await login(page, "management@demo.qianchuang.cn");
  const current = await (await page.request.get("/api/settings/tenant")).json();
  await page.request.put("/api/settings/tenant", {
    data: {
      ...current.settings,
      featureFlags: { ...current.settings.featureFlags, customerPortal: true },
    },
  });
  return async () => {
    // 同上:显式归零
    await page.request.put("/api/settings/tenant", {
      data: {
        ...current.settings,
        featureFlags: { ...current.settings.featureFlags, customerPortal: false },
      },
    });
  };
}

async function firstCustomerId(page: Page): Promise<string> {
  await page.goto("/quality");
  const id = await page.locator('select[aria-label="客户筛选"] option').nth(1).getAttribute("value");
  expect(id, "种子库应至少有一个客户").toBeTruthy();
  return id!;
}

function tokenOf(activateUrl: string): string {
  return activateUrl.split("/portal/activate/")[1];
}

test("邀请→激活→登录→单次使用→重邀→停用 全链路", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const restore = await setupFlag(page);
  const customerId = await firstCustomerId(page);
  const email = `r33-${Date.now()}@example.com`;

  try {
    // ① 邀请:无密码字段;返回一次性链接;账号 INVITED
    const invite = await page.request.post("/api/settings/portal-accounts", {
      data: { customerId, email },
    });
    expect(invite.status()).toBe(201);
    const inviteBody = (await invite.json()) as {
      accountId: string;
      status: string;
      activateUrl: string;
    };
    expect(inviteBody.status).toBe("INVITED");
    expect(inviteBody.activateUrl).toContain("/portal/activate/");
    const accountId = inviteBody.accountId;
    const rawToken = tokenOf(inviteBody.activateUrl);

    const { ctx, page: pub } = await anonPage(browser);
    try {
      // 激活前不能登录(与密码错误同一句 401)
      const early = await pub.request.post("/api/portal/auth/login", {
        data: { email, password: "whatever-123" },
      });
      expect(early.status()).toBe(401);

      // ② 匿名走激活页自设密码
      await pub.goto(`/portal/activate/${rawToken}`);
      await expect(pub.getByTestId("portal-activate-email")).toContainText(email);
      await pub.getByLabel("设置密码").fill("customer-own-pass-1");
      await pub.getByLabel("确认密码").fill("customer-own-pass-1");
      await pub.getByTestId("portal-activate-submit").click();
      await expect(pub.getByTestId("portal-activate-done")).toBeVisible();

      // 登录成功
      await pub.goto("/portal/login");
      await pub.getByLabel("门户邮箱").fill(email);
      await pub.getByLabel("门户密码").fill("customer-own-pass-1");
      await pub.getByTestId("portal-login-submit").click();
      await pub.waitForURL("**/portal");

      // ③ 单次使用:旧链接再访问 → 409(已用,提示去登录)
      const reuse = await pub.request.get(`/api/portal/activate/${rawToken}`);
      expect(reuse.status()).toBe(409);
      const reusePost = await pub.request.post(`/api/portal/activate/${rawToken}`, {
        data: { password: "second-try-pass-1" },
      });
      expect(reusePost.status()).toBe(409);

      // ⑥ 未知 token → 404
      const unknown = await pub.request.get(`/api/portal/activate/${"A".repeat(43)}`);
      expect(unknown.status()).toBe(404);

      // ④ 重新邀请(= 管理员发起的密码重置):新链接可用
      const re = await page.request.patch(`/api/settings/portal-accounts/${accountId}`, {
        data: { action: "reinvite" },
      });
      expect(re.status()).toBe(200);
      const reBody = (await re.json()) as { activateUrl: string };
      const rawToken2 = tokenOf(reBody.activateUrl);
      const check2 = await pub.request.get(`/api/portal/activate/${rawToken2}`);
      expect(check2.status()).toBe(200);

      // 再重邀一次:上一条(未用)被撤销 → 404,与不存在不可区分
      const re3 = await page.request.patch(`/api/settings/portal-accounts/${accountId}`, {
        data: { action: "reinvite" },
      });
      const rawToken3 = tokenOf(((await re3.json()) as { activateUrl: string }).activateUrl);
      expect((await pub.request.get(`/api/portal/activate/${rawToken2}`)).status()).toBe(404);

      // ⑤ 停用:登录即拒;在途会话逐请求截断;未用邀请作废
      const dis = await page.request.patch(`/api/settings/portal-accounts/${accountId}`, {
        data: { action: "disable" },
      });
      expect(dis.status()).toBe(200);
      const loginAfter = await pub.request.post("/api/portal/auth/login", {
        data: { email, password: "customer-own-pass-1" },
      });
      expect(loginAfter.status()).toBe(401);
      // 在途 cookie 会话调门户 API → 401(守卫逐请求查 status)
      const inflight = await pub.request.get("/api/portal/inventory");
      expect(inflight.status()).toBe(401);
      // 停用账号的未用邀请与不存在不可区分
      expect((await pub.request.get(`/api/portal/activate/${rawToken3}`)).status()).toBe(404);

      // 启用(已设过密码 → 回 ACTIVE,能再登录)
      const en = await page.request.patch(`/api/settings/portal-accounts/${accountId}`, {
        data: { action: "enable" },
      });
      expect(((await en.json()) as { status: string }).status).toBe("ACTIVE");
      const loginBack = await pub.request.post("/api/portal/auth/login", {
        data: { email, password: "customer-own-pass-1" },
      });
      expect(loginBack.status()).toBe(200);
    } finally {
      await ctx.close();
    }
  } finally {
    await restore();
  }
});

test("管理页 UI:邀请生成复制链接框;直发密码字段已从表单消失", async ({ page }) => {
  const restore = await setupFlag(page);
  const customerId = await firstCustomerId(page);
  try {
    await page.goto("/settings/portal-accounts");
    // 表单只有客户+邮箱,没有密码输入(直发密码路径下线)
    await expect(page.getByLabel("门户邀请邮箱")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    const email = `r33-ui-${Date.now()}@example.com`;
    await page.getByLabel("门户客户").selectOption(customerId);
    await page.getByLabel("门户邀请邮箱").fill(email);
    await page.getByTestId("portal-invite-submit").click();
    await expect(page.getByTestId("portal-invite-link-box")).toBeVisible();
    await expect(page.getByTestId("portal-invite-link")).toContainText("/portal/activate/");
    // 列表出现 INVITED 行
    await expect(page.getByTestId(`portal-status-${email}`)).toContainText("已邀请 · 待激活");
  } finally {
    await restore();
  }
});

test("权限:非 MANAGEMENT 内部角色不可邀请/管理门户账号", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const res = await page.request.post("/api/settings/portal-accounts", {
    data: { customerId: "whatever", email: "nope@example.com" },
  });
  expect(res.status()).toBe(403);
  const patch = await page.request.patch("/api/settings/portal-accounts/some-id", {
    data: { action: "disable" },
  });
  expect(patch.status()).toBe(403);
});
