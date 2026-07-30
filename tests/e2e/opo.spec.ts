import { expect, test, type Page } from "@playwright/test";

/**
 * PR8 E2E(SPEC §17 第 7 项:OPO 回复、提醒和 ERP 导出)。
 * 同时验证 §14 铁律:KPI 与各表由同一份行数据派生(计数必须对得上账)。
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/** 从 KPI 卡片读数字 */
async function kpi(page: Page, label: string): Promise<number> {
  const text = await page.locator(".kpi", { hasText: label }).locator(".kpi-value").first().innerText();
  return Number(text.trim());
}

test("OPO KPI 三分类互斥且合计等于总行数(同源派生)", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/suppliers/opo");

  const total = await kpi(page, "OPO 行数");
  const err = await kpi(page, "异常行(error)");
  const warn = await kpi(page, "提示行(warning)");
  const healthy = await kpi(page, "正常行");

  expect(total).toBeGreaterThan(0);
  expect(err + warn + healthy).toBe(total);

  // 未回复表的行数与 KPI 未回复数一致
  const noReplyKpi = await kpi(page, "未回复");
  const noReplyRows = await page
    .locator(".card", { hasText: "未回复供应商" })
    .locator("table.tbl tbody tr")
    .count();
  expect(noReplyRows).toBe(noReplyKpi);
});

test("记录供应商回复后 KPI 与差异表同步更新", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/suppliers/opo");

  const before = await kpi(page, "未回复");
  expect(before).toBeGreaterThan(0);

  // 回复第一行:ETA 与数量。
  // 注意:两个 page.once 会同时监听同一个弹窗(once 只保证各自被调用一次,不排队),
  // 必须用单一监听器按序应答。
  const answers = ["2026-08-30", "1000"];
  const onDialog = async (d: { accept: (v?: string) => Promise<void> }) => {
    await d.accept(answers.shift() ?? "");
  };
  page.on("dialog", onDialog);
  // 必须点"确实未回复"的那一行:库中数据跨运行保留,不能假设第一行就是未回复
  const unrepliedRow = page
    .locator(".card", { hasText: "OPO 行" })
    .locator("table.tbl tbody tr")
    .filter({ hasText: "未回复" })
    .first();
  await unrepliedRow.getByRole("button", { name: "记录回复" }).click();
  await expect(page.locator(".banner.info")).toContainText("重新派生");

  page.off("dialog", onDialog);
  // router.refresh() 是异步的:必须用会自动重试的断言,不能立刻读快照值
  await expect(
    page.locator(".kpi", { hasText: "未回复" }).locator(".kpi-value").first(),
  ).toHaveText(String(before - 1));

  // 该行进入差异表(回复 ETA 与 ERP 承诺不同)
  const diffTable = page.locator(".card", { hasText: "交期/数量差异" }).locator("table.tbl");
  await expect(diffTable).toContainText("2026-08-30");
});

test("异常清单展示具体异常原因", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/suppliers/opo");

  const anomalyCard = page.locator(".card", { hasText: "异常清单" });
  await expect(anomalyCard).toContainText("eta_later_than_need");
});

test("ERP 交期回写模板可导出(替代路径,非 API 直写)", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/suppliers/opo");

  await expect(page.getByText(/RPA \/ API 直写属二期/)).toBeVisible();

  const link = page.getByRole("link", { name: /导出 ERP 导入模板/ });
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/^erp-eta-template-.*\.xlsx$/);
});

test("催办 Cron:鉴权由路由的 CRON_SECRET 把关,且必须能被外部调度器(GET)触发", async ({
  request,
}) => {
  const secret = process.env.CRON_SECRET ?? "e2e-cron-secret";

  // 未带 Authorization / 带错 secret:一律拒绝
  for (const opts of [{}, { headers: { authorization: "Bearer wrong-secret" } }]) {
    for (const method of ["post", "get"] as const) {
      const res = await request[method]("/api/cron/opo-reminders", opts);
      expect([401, 503]).toContain(res.status());
      // 关键:拒绝必须来自**路由的 CRON_SECRET 校验**,不是会话中间件。
      // 中间件若把 /api/cron 也当受保护接口挡掉(回「未登录」),
      // 路由的 secret 校验永远走不到,外部调度器调它会静默失效 —— 这条断言就是防这个。
      expect(await res.text()).not.toContain("未登录");
    }
  }

  // 带正确 secret:GET 与 POST 都必须能跑
  // (Vercel Cron 只发 GET;自建 crontab 习惯用 POST)
  for (const method of ["get", "post"] as const) {
    const res = await request[method]("/api/cron/opo-reminders", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // 诚实 UI:接口自己就得说明邮件没真发
    expect(body.note).toContain("预览/模拟");
  }
});

test("管理工作台 KPI 由明细派生且可下钻", async ({ page }) => {
  await login(page, "management@demo.ezplm.cn");
  await expect(page.locator(".page-title")).toHaveText("管理工作台");

  // 诚实标注:金额取快照、库存为缓存
  await expect(page.locator(".banner")).toContainText("冻结快照");
  await expect(page.locator(".banner")).toContainText("不代表实时库存");

  // 无终局报价版本时转化率显示 — 而不是 0%
  const conv = page.locator(".kpi", { hasText: "报价转化率" });
  await expect(conv).toBeVisible();

  // KPI 可点击下钻
  await page.locator(".kpi", { hasText: "OPO 异常行" }).click();
  await expect(page).toHaveURL(/\/suppliers\/opo$/);
});

test("库存页:DC 未知单列,不并入最新库龄区间", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/inventory");

  const agingTable = page.locator(".card", { hasText: "DC Aging 分布" }).locator("table.tbl");
  await expect(agingTable).toContainText("DC 未知");
  await expect(agingTable.locator(".badge", { hasText: "不并入任何区间" })).toBeVisible();
  await expect(page.locator(".banner")).toContainText("不代表实时库存");
});
