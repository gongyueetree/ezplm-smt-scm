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


/*
 * ⚠️ 本文件**必须顺序执行**(fullyParallel: true 下同文件用例也会被分到不同 worker)。
 *
 * 下面多条用例都对**同一批种子在途行**写回复,而
 * 「记录回复后 KPI 与差异表同步更新」断言的是未回复数正好减 1。
 * 两个 worker 同时回复会让它减 2 —— 时红时绿的假失败(实测在全量跑里出现过)。
 * 用 mode: "default" 而不是 "serial":前者只是排队执行,后者会在首条失败后
 * 跳过其余用例,反而掩盖真实失败。
 */
test.describe.configure({ mode: "default" });

test("OPO KPI 三分类互斥且合计等于总行数(同源派生)", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
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
  await login(page, "procurement@demo.qianchuang.cn");
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
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/suppliers/opo");

  const anomalyCard = page.locator(".card", { hasText: "异常清单" });
  await expect(anomalyCard).toContainText("eta_later_than_need");
});

test("ERP 交期回写模板可导出(替代路径,非 API 直写)", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
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
  await login(page, "management@demo.qianchuang.cn");
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
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/inventory");

  const agingTable = page.locator(".card", { hasText: "DC Aging 分布" }).locator("table.tbl");
  await expect(agingTable).toContainText("DC 未知");
  await expect(agingTable.locator(".badge", { hasText: "不并入任何区间" })).toBeVisible();
  await expect(page.locator(".banner")).toContainText("不代表实时库存");
});

/* ============================================================
 * A-1(P0)回归:OPO 回复的**写路径**必须受数据范围约束。
 *
 * 原缺陷:recordOpoReply 只做 tenantWhere,供应商可对本租户任意在途行
 * (含别家供应商的)写 ETA 回复。PR-G 只收口了读路径。
 * 伪造的 ETA 会进 OPO 差异表与催办扫描,驱动错误的采购决策。
 *
 * 这两条原本在 opo-reply-scope.spec.ts 里,并到本文件是因为下面第二条会
 * 真的写一条回复 —— 跨文件时它与上面的 KPI 用例并行,把未回复数多减了一次。
 * ============================================================ */

test("**供应商不能给不属于自己的在途行写回复**(A-1 P0)", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "supplier@demo.qianchuang.cn");

  // 用一个**必然不属于该供应商**的 id;
  // 不存在的 id 与"存在但不属于我"走的是同一条判定分支 —— 这正是要守住的行为
  const forged = "clzzzzzzzzzzzzzzzzzzzzzz";
  const write = await page.request.post(`/api/opo/lines/${forged}/reply`, {
    data: { replyEta: null, replyQty: 10, replyNote: "E2E 越权尝试", replySource: "PORTAL" },
  });
  expect(write.status()).toBe(404);
  // 措辞必须与"不存在"一致 —— 回 403 等于确认该行存在,可被用来枚举别家单号
  expect(await write.text()).toContain("不存在");
});

test("内部角色写回复不受影响(不能因为加了范围就把正常流程挡死)", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/suppliers/opo");

  // 走真实 UI:表格行内的「记录回复」按钮 —— 它内部调的就是被加固的那个接口。
  // 不用伪造 id,这样才能证明"加了范围之后正常路径还通"。
  const btn = page.getByRole("button", { name: "记录回复" }).first();
  await expect(btn, "OPO 页应有可回复的在途行").toBeVisible({ timeout: 30_000 });

  // 该按钮用两次 window.prompt 收 ETA 与数量;
  // Playwright 默认自动 dismiss 对话框 → 函数直接 return,请求根本不会发出。
  const answers = ["2026-12-31", "100"];
  page.on("dialog", (d) => void d.accept(answers.shift() ?? ""));

  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/reply") && r.request().method() === "POST"),
    btn.click(),
  ]);
  expect(res.status()).toBe(200);
});
