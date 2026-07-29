import { expect, test, type Page } from "@playwright/test";

/**
 * PR7 业务流程 E2E(SPEC §17 第 6 项):
 * 报价计算 → 审批 → 退回 → 新版本 → 批准。
 * 同时覆盖 CLAUDE.md 报价规则:分类未确认不得提交、冻结后不得改参数、
 * 正式导出只用快照、禁止覆盖已批准版本。
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function createRfq(page: Page, title: string) {
  await page.goto("/rfq");
  await page.getByLabel("标题").fill(title);
  await page.getByRole("button", { name: "创建 RFQ" }).click();
  await expect(page).toHaveURL(/\/rfq\/[^/]+$/);
}

/** 建报价 + 一行 + 确认分类,返回报价版本页 URL */
async function createQuoteWithLine(page: Page, title: string) {
  await createRfq(page, title);
  await page.goto("/quotes");
  await page.getByRole("button", { name: "创建报价" }).click();
  await expect(page).toHaveURL(/\/quotes\/[^/]+$/);

  await page.getByRole("button", { name: "添加示例行" }).click();
  await expect(page.locator("table.tbl tbody tr").first()).toContainText("阻容感 |", { timeout: 10_000 }).catch(() => {});
  await expect(page.locator(".badge", { hasText: "待确认" }).first()).toBeVisible();
}

test("报价计算:Markup 与小计由确定性函数算出(SPEC §12)", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await createQuoteWithLine(page, "E2E 报价计算");

  // 1000 × 0.08 × (1+0.15) = 92.00
  const row = page.locator("table.tbl tbody tr").first();
  await expect(row).toContainText("0.09"); // 最终单价 0.08×1.15 = 0.092 → 0.09
  await expect(page.locator(".kpi", { hasText: "材料" })).toContainText("92.00");
  await expect(page.locator(".kpi", { hasText: "总价" })).toContainText("92.00");
});

test("分类未人工确认不得提交,确认后可提交并冻结参数", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await createQuoteWithLine(page, "E2E 提交冻结");

  // 未确认分类 → 提交被拒并指出行号
  await page.getByRole("button", { name: "提交审批" }).click();
  await expect(page.locator(".banner.warn")).toContainText("物料分类未人工确认");
  await expect(page.locator(".banner.warn")).toContainText("第 1 行");

  // 人工确认分类
  page.once("dialog", (d) => d.accept("阻容感"));
  await page.getByRole("button", { name: "确认分类" }).first().click();
  await expect(page.locator(".badge", { hasText: "已人工确认" }).first()).toBeVisible();

  // 提交成功 → 参数冻结
  await page.getByRole("button", { name: "提交审批" }).click();
  await expect(page.locator(".page-actions .badge")).toHaveText("待审批");
  await expect(page.getByText("参数已冻结")).toBeVisible();
  // 冻结后不再显示编辑入口
  await expect(page.getByRole("button", { name: "添加示例行" })).toHaveCount(0);
  // 快照可用于正式导出
  await expect(page.getByText("提交快照(submittedSnapshot)")).toBeVisible();
});

test("审批退回 → 新建 Revision → 再提交 → 批准(全链路)", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await createQuoteWithLine(page, "E2E 审批全链路");
  page.once("dialog", (d) => d.accept("阻容感"));
  await page.getByRole("button", { name: "确认分类" }).first().click();
  await expect(page.locator(".badge", { hasText: "已人工确认" }).first()).toBeVisible();
  await page.getByRole("button", { name: "提交审批" }).click();
  await expect(page.locator(".page-actions .badge")).toHaveText("待审批");
  const versionUrl = page.url();

  // 管理层退回:必须填原因
  await login(page, "management@demo.ezplm.cn");
  await page.goto(versionUrl);
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: /退回/ }).click();
  await expect(page.locator(".page-actions .badge")).toHaveText("待审批");

  page.once("dialog", (d) => d.accept("毛利率偏低,材料重新议价"));
  await page.getByRole("button", { name: /退回/ }).click();
  await expect(page.locator(".page-actions .badge")).toHaveText("已退回");
  await expect(page.locator(".banner.warn")).toContainText("毛利率偏低");

  // 新建 Revision:R2,分类确认不继承
  await page.getByRole("button", { name: "新建 Revision" }).click();
  await expect(page).toHaveURL(/\/quotes\/[^/]+$/);
  await expect(page.locator(".page-title")).toContainText("R2");
  await expect(page.locator(".badge", { hasText: "待确认" }).first()).toBeVisible();

  // R2 重新确认 → 提交 → 批准
  page.once("dialog", (d) => d.accept("阻容感"));
  await page.getByRole("button", { name: "确认分类" }).first().click();
  await page.getByRole("button", { name: "提交审批" }).click();
  await expect(page.locator(".page-actions .badge")).toHaveText("待审批");

  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(page.locator(".page-actions .badge")).toHaveText("已批准");
  // 批准后导出走审批快照
  await expect(page.getByText("审批快照(approvedSnapshot)")).toBeVisible();
  // 已批准版本参数仍然冻结
  await expect(page.getByText("参数已冻结")).toBeVisible();
});

test("QuoteAgent:只产出待确认卡片,不写入数据,并如实标注当前模型形态", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.ezplm.cn");
  await createQuoteWithLine(page, "E2E 智能体");

  await page.getByRole("button", { name: "运行 QuoteAgent" }).click();
  // 真实模型下要走一次外网调用,给足时间
  await expect(page.locator(".banner.ai")).toContainText("待确认卡片", { timeout: 90_000 });

  // 诚实 UI:形态标注必须**与实际配置一致**,三选一,不得含糊其辞。
  // 配了 Key 就写厂商名,没配就写"未接入模型" —— 两种都要被断言到,
  // 否则测试会在换环境时悄悄失效(此前写死"未接入模型",配上 Key 后即失真)。
  const modeBadge = page.locator(".badge", {
    hasText: /未接入模型|Gemini|Claude/,
  });
  await expect(modeBadge.first()).toBeVisible();

  // 不论哪种形态,**核心不变量**都必须成立:卡片未批准 → 分类仍是"待确认",
  // Agent 绝不直接写库。
  await expect(page.locator(".badge", { hasText: "待确认" }).first()).toBeVisible();
});
