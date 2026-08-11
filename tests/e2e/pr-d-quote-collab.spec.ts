import { expect, test, type Page } from "@playwright/test";

/**
 * PR-D / PR2-PM-06:报价责任拆分 + NRE + 订单转化率。
 *
 * 客户答复:
 * - Q6:工程填完 NRE **直接回报价,不需审批**;**PM 派工**;NRE 项可选、要有备注;
 * - Q7:订单转化 **人工在报价单上标记「已中标」**。
 *
 * 用例守四条:
 * ① 勾了「必须完成」的分项没回,提交审批必须被拦;
 * ② NRE 金额留空**不当 0**;
 * ③ NRE 填完直接变成报价行并进总额,**中间没有审批**;
 * ④ 没有审批通过的版本**标不了中标**。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function createQuote(page: Page, title: string) {
  await page.goto("/rfq");
  await page.getByLabel("标题").fill(title);
  await page.getByRole("button", { name: "创建 RFQ" }).click();
  await expect(page).toHaveURL(/\/rfq\/[^/]+$/);
  await page.goto("/quotes");
  await page.getByRole("button", { name: "创建报价" }).click();
  await expect(page).toHaveURL(/\/quotes\/[^/]+$/);
}

test("NRE 填完直接成为报价行并进总额 —— 中间没有审批环节", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.qianchuang.cn");
  await createQuote(page, `E2E NRE ${Date.now()}`);

  await expect(page.getByTestId("collab-panel")).toBeVisible();

  // 金额留空 → 必须被拒,而且要说清"不会按 0 处理"
  await page.getByLabel("NRE 名称 1").fill("治具费");
  await page.getByTestId("nre-submit").click();
  await expect(page.getByTestId("collab-error")).toContainText("不会按 0 处理", { timeout: 20_000 });

  // 填上金额 + 备注 → 直接写进报价行
  await page.getByLabel("NRE 金额 1").fill("1200");
  await page.getByLabel("NRE 备注 1").fill("含一次改版");
  await page.getByTestId("nre-submit").click();
  await expect(page.getByTestId("collab-note")).toContainText("无需单独审批", { timeout: 20_000 });

  // 报价行里出现这一项,总价包含 1200
  const row = page.locator("table.tbl tbody tr").filter({ hasText: "治具费" });
  await expect(row.first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".kpi", { hasText: "总价" })).toContainText("1200.00");
});

test("勾了「必须完成」的分项没回,提交审批被拦下", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.qianchuang.cn");
  await createQuote(page, `E2E 派工 ${Date.now()}`);

  // 先加一行并确认分类,排除"分类未确认"这个先决条件
  await page.getByRole("button", { name: "添加示例行" }).click();
  page.once("dialog", (d) => d.accept("阻容感"));
  await page.getByRole("button", { name: "确认分类" }).first().click();
  await expect(page.locator(".badge", { hasText: "已人工确认" }).first()).toBeVisible();

  // 派一个「必须完成」的分项
  await page.getByLabel("事项").fill("测试架费用待工程确认");
  await page.getByLabel("必须完成才能提交").check();
  await page.getByRole("button", { name: "派工" }).click();
  await expect(page.getByTestId("blocking-tasks")).toContainText("提交审批会被拦下", {
    timeout: 20_000,
  });

  // 提交审批 → 被拦
  await page.getByRole("button", { name: "提交审批" }).click();
  /*
   * 锁定**编辑器自己的**错误提示。
   * 用 `.banner.warn` 会先命中上面那条「有 N 项必须完成」的提示 ——
   * 那条不点提交也在,断言它等于什么都没验。
   */
  await expect(page.getByTestId("quote-editor-error")).toContainText("必须完成", { timeout: 20_000 });
  // 状态没有变成待审批
  await expect(page.locator(".page-actions .badge").first()).not.toHaveText("待审批");
});

test("没有审批通过的版本标不了「已中标」", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.qianchuang.cn");
  await createQuote(page, `E2E 中标 ${Date.now()}`);

  await page.getByLabel("订单结果").selectOption("WON");
  await page.getByTestId("outcome-submit").click();
  await expect(page.getByTestId("collab-error")).toContainText("谈不上中标", { timeout: 20_000 });
  await expect(page.getByTestId("outcome-badge")).toHaveText("待定");
});

test("管理看板把「订单转化率」与「审批通过率」分成两个指标", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  const board = page.locator(".kpi-grid").first();
  await expect(board.locator(".kpi-label", { hasText: "订单转化率" })).toBeVisible();
  await expect(board.locator(".kpi-label", { hasText: "审批通过率" })).toBeVisible();
  // 审批通过率必须自带"这不是成单率"的说明,否则又会被当成转化率读
  await expect(page.getByText("内部流程指标,不是成单率")).toBeVisible();
  // 转化率口径要写明待定不进分母
  await expect(page.getByText(/待定 \d+ 张不进分母|尚无已定局的报价/)).toBeVisible();
});
