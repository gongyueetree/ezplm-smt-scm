import { expect, test, type Page } from "@playwright/test";

/**
 * PR-H 生产加固 E2E:运维可观测性。
 *
 * 关键口径:**无样本返回 null**,前端显示为「无样本」——
 * 0% 成功率与「这周没跑过」是两回事,前者要立刻处理,后者只是没数据。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("运维总览:含整体指标、分连接指标、连接健康与人工队列", async ({ page }) => {
  await login(page, "management@demo.ezplm.cn");
  const res = await page.request.get("/api/settings/ops-health?days=7");
  expect(res.status()).toBe(200);
  const b = await res.json();

  expect(b.windowDays).toBe(7);
  expect(b.overall).toBeTruthy();
  expect(Array.isArray(b.perConnection)).toBe(true);
  expect(Array.isArray(b.connections)).toBe(true);
  expect(b.queues).toHaveProperty("unresolvedConflicts");
  expect(b.queues).toHaveProperty("pendingRetry");
});

test("**无样本时是 null 而不是 0** —— 两者含义完全不同", async ({ page }) => {
  await login(page, "management@demo.ezplm.cn");
  const res = await page.request.get("/api/settings/ops-health?days=1");
  const b = await res.json();

  // 没有作业时各比率必须是 null;有作业时必须是 0–1 的数
  for (const key of ["successRate", "partialRate"] as const) {
    const v = b.overall[key];
    expect(v === null || (typeof v === "number" && v >= 0 && v <= 1)).toBe(true);
  }
  if (b.overall.total === 0) {
    expect(b.overall.successRate).toBeNull();
    expect(b.overall.avgDurationMs).toBeNull();
  }
});

test("时间窗有上下限,不会被极值搞爆", async ({ page }) => {
  await login(page, "management@demo.ezplm.cn");
  expect((await (await page.request.get("/api/settings/ops-health?days=9999")).json()).windowDays).toBe(90);
  expect((await (await page.request.get("/api/settings/ops-health?days=0")).json()).windowDays).toBe(1);
  expect((await (await page.request.get("/api/settings/ops-health?days=abc")).json()).windowDays).toBe(7);
});

test("连接健康**每条都带判定依据**,不只给分数", async ({ page }) => {
  await login(page, "management@demo.ezplm.cn");
  const b = await (await page.request.get("/api/settings/ops-health")).json();
  for (const c of b.connections) {
    expect(Array.isArray(c.health.reasons)).toBe(true);
    expect(c.health.reasons.length).toBeGreaterThan(0);
  }
});
