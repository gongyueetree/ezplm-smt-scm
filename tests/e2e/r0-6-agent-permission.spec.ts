import { expect, test, type Page } from "@playwright/test";

/**
 * R0-6:AI 写提案的两个端点此前**只有 requireSession** ——
 * 任何已登录的租户用户都能触发 Agent 运行(有外部模型成本),
 * 并且能批准 AI 写入报价行。人工确认闭环形同虚设。
 *
 * 这里锁两件事:
 * 1. 无权限即 403,且**发生在查库之前** —— 用一个不存在的 id 调,
 *    拿到的必须是 403 而不是 404。否则无权者能从 404/422 的差别里
 *    探出某张卡片是否存在(与公开链路「未知与撤销一律 404 防枚举」同源的纪律)。
 * 2. 运行与批准**分权**:PM 能跑,但不能批。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("无 quote.agent.approve 的角色批准 AI 写提案 → 403,且早于查库", async ({ page }) => {
  await login(page, "supplier@demo.qianchuang.cn");
  const res = await page.request.post("/api/agent-approvals/not-a-real-approval-id", {
    data: { decision: "APPROVED" },
  });
  expect(res.status()).toBe(403);
  expect(await res.text()).toContain("quote.agent.approve");
});

test("PM 可跑 Agent,但**不能批准**写入(提议与批准分离)", async ({ page }) => {
  await login(page, "pm@demo.qianchuang.cn");

  // 批准:无权 → 403(不是 404,说明守卫在查库之前)
  const approve = await page.request.post("/api/agent-approvals/not-a-real-approval-id", {
    data: { decision: "APPROVED" },
  });
  expect(approve.status()).toBe(403);

  // 运行:有权 → 不该是 403;版本不存在时应是 404,证明守卫放行后才去查库
  const run = await page.request.post("/api/quotes/not-a-real-version-id/agent", { data: {} });
  expect(run.status()).not.toBe(403);
  expect(run.status()).toBe(404);
});

test("无 quote.agent.run 的角色触发 Agent 运行 → 403(外部模型调用有成本)", async ({ page }) => {
  await login(page, "supplier@demo.qianchuang.cn");
  const res = await page.request.post("/api/quotes/not-a-real-version-id/agent", { data: {} });
  expect(res.status()).toBe(403);
  expect(await res.text()).toContain("quote.agent.run");
});
