import { expect, test, type Page } from "@playwright/test";

/**
 * PR-D 生产加固 E2E:ERP 同步可靠性。
 *
 * 覆盖:
 * - 连接健康度接口按**趋势**判定,不是最后一次是否碰巧通了;
 * - 从未成功过的连接显示 UNVERIFIED,**不显示绿灯**;
 * - 重试受权限约束;
 * - 不存在的作业重试返回 404 而不是 500。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("连接健康接口:每条连接都带判定依据,不只给一个分数", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  const res = await page.request.get("/api/settings/integrations/erp/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.connections)).toBe(true);

  for (const c of body.connections) {
    expect(c.health).toBeTruthy();
    // 必须给出人可读的依据,而不是让人对着分数猜
    expect(Array.isArray(c.health.reasons)).toBe(true);
    expect(c.health.reasons.length).toBeGreaterThan(0);
    expect(["HEALTHY", "WARNING", "OFFLINE", "UNVERIFIED", "DISABLED"]).toContain(c.health.state);
    // 从未成功过的连接绝不能是 HEALTHY
    if (c.health.hoursSinceSuccess === null && c.health.state !== "DISABLED") {
      expect(c.health.state).not.toBe("HEALTHY");
    }
  }
});

test("**查看与执行分离**:普通角色可看健康状态,但不能执行同步/重试", async ({ page }) => {
  // 设计如此(原始要求:「管理层和系统管理员可配置;普通用户只可查看同步状态」)——
  // erp.connection.view 对所有角色开放,受限的是 erp.sync.execute。
  await login(page, "pm@demo.qianchuang.cn");
  const canView = await page.request.get("/api/settings/integrations/erp/health");
  expect(canView.status()).toBe(200);

  const cannotRetry = await page.request.post(
    "/api/settings/integrations/erp/jobs/whatever/retry",
  );
  expect(cannotRetry.status()).toBe(403);
  expect(await cannotRetry.text()).toContain("erp.sync.execute");
});

test("重试不存在的作业返回 404,而不是 500", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  const res = await page.request.post(
    "/api/settings/integrations/erp/jobs/no-such-job-id/retry",
  );
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain("不属于当前租户");
});

test("重试受权限约束:无 erp.sync.execute 的角色被拒", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const res = await page.request.post(
    "/api/settings/integrations/erp/jobs/whatever/retry",
  );
  expect(res.status()).toBe(403);
});
