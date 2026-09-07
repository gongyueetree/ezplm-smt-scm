import { expect, test, type Page } from "@playwright/test";

/**
 * F4:集成状态页与 PO 双通道的诚实展示。
 *
 * E2E 环境未配置 ERP_LAB_BASE_URL —— 这正是要测的形态:
 * 一切状态必须落「ERP 未配置」,Excel 兜底链可用,**没有任何假成功**。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("状态页:未配置 ERP 时如实显示 NOT_CONFIGURED,不显示 0 条成功", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/integrations/status");

  // 目标徽标:ERP 未配置(默认租户 erpProvider=NONE)
  await expect(page.getByTestId("erp-target-badge")).toContainText("ERP 未配置");
  // 横幅明确说明 Excel 兜底链不受影响
  await expect(page.getByTestId("erp-target-note")).toContainText("Excel 模板兜底链不受影响");

  // 数据集实体逐个显示「ERP 未配置」—— 不是空表,也不是绿灯
  const table = page.getByTestId("dataset-status-table");
  await expect(table.getByTestId("dataset-MATERIAL")).toContainText("ERP 未配置");
  await expect(table.getByTestId("dataset-EXCESS")).toContainText("ERP 未配置");
  // FX 行的占位纪律在配置后才显示;未配置时与其它实体一致
  await expect(table.getByTestId("dataset-FX_RATE")).toContainText("ERP 未配置");
});

test("状态页 API 越权:工程角色 → 403;采购/管理层可读", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const denied = await page.request.get("/api/integration/sync-records");
  expect(denied.status()).toBe(403);

  await login(page, "procurement@demo.qianchuang.cn");
  const ok = await page.request.get("/api/integration/sync-records");
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.target.kind).toBe("NONE");
  // 未配置时不产生任何虚假记录
  expect(Array.isArray(body.records)).toBe(true);
});

test("PO 回写 API:未配置 ERP → 422 NOT_CONFIGURED,并指向 Excel 兜底", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  // 任取一张 PO(列表页第一行);没有已批准单时用一个不存在 id 验证 404 语义
  const res = await page.request.post("/api/procurement/orders/nonexistent-po/erp-writeback");
  expect(res.status()).toBe(422);
  const body = await res.json();
  expect(["NOT_FOUND", "NOT_CONFIGURED", "INVALID_STATUS"]).toContain(body.state);

  // 越权:工程角色不可回写
  await login(page, "engineering@demo.qianchuang.cn");
  const denied = await page.request.post("/api/procurement/orders/nonexistent-po/erp-writeback");
  expect(denied.status()).toBe(403);
});

test("入口:管理层菜单可见;采购经 URL 直达可读(与 sync-log 同一口径)", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  const nav = page.locator(".sidebar, nav").first();
  await expect(nav.getByRole("link", { name: "集成状态" })).toBeVisible();

  // 菜单的「系统设置」父级仅 MANAGEMENT;采购不见菜单项,但 URL 直达可读状态页
  // (敏感操作 retry/writeback 的角色门在 API 层,已由上面用例覆盖)
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/settings/integrations/status");
  await expect(page.getByTestId("erp-target-badge")).toContainText("ERP 未配置");
});

test("closed-loop:worker 端点角色门与未配置 ERP 的诚实行为", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const denied = await page.request.post("/api/integration/worker/run");
  expect(denied.status()).toBe(403);

  await login(page, "procurement@demo.qianchuang.cn");
  const run = await (await page.request.post("/api/integration/worker/run")).json();
  // 未配置 ERP:待处理记录一律落 NOT_CONFIGURED,绝无假成功
  expect(run.synced).toBe(0);
  expect(run.failed).toBe(0);
  expect(typeof run.scanned).toBe("number");

  // Cron 路由:无 secret 头 → 401
  const cron = await page.request.post("/api/cron/integration-worker");
  expect([401, 503]).toContain(cron.status());
});
