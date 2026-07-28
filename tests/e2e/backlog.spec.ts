import { expect, test, type Page } from "@playwright/test";

/**
 * 补齐批次 E2E:
 * - B1 PM 采购申请单(GTB 核算)
 * - B2 供应商预设维护
 * - B3 采购策略阈值维护(未确认口径必须标注)
 * - PR7 遗留:快照 XLSX 导出
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("B1 采购申请单:GTB 试算展示完整过程并标注损耗率待确认", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/procurement/request");

  await page.getByLabel("需求数量").fill("1000");
  await page.getByLabel("损耗率(0.02 = 2%,待甲方确认)").fill("0.02");
  await page.getByLabel("MOQ(可空)").fill("500");
  await page.getByLabel("SPQ(可空)").fill("250");
  await page.getByRole("button", { name: "试算 GTB" }).click();

  // 1000 × 1.02 = 1020(向上取整)
  await expect(page.locator(".kpi", { hasText: "毛需求" })).toContainText("1020");
  // 损耗率口径必须标注待确认
  await expect(page.locator(".badge", { hasText: "损耗率待甲方确认" })).toBeVisible();
  // 计算过程逐步留痕
  await expect(page.getByText(/毛需求 = ceil/)).toBeVisible();
  await expect(page.getByText(/净需求 =/)).toBeVisible();

  await page.getByRole("button", { name: "提交采购申请" }).click();
  await expect(page.locator("table.tbl tbody tr").first()).toContainText("PR-");
});

test("B3 采购策略:未确认口径标注为非正式风控,保存后生效", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/procurement/suppliers");

  // 自建前置:先落一份「口径未确认」的策略(库中数据跨运行保留,不能假设初始态)
  await page.getByLabel("价格线(留空=不校验)").fill("12");
  await page.getByLabel("交期线 / 天(留空=不校验)").fill("25");
  await page.getByLabel(/口径已业务确认/).uncheck();
  await page.getByRole("button", { name: "保存策略" }).click();
  await expect(page.locator(".banner.info")).toContainText("原始异常标记不受影响");

  // 未确认口径 → 顶部警示"非正式风控"
  await expect(page.locator(".banner.warn")).toContainText("不得作为正式风控依据");

  // 勾选口径已确认 → 警示消失
  await page.getByLabel(/口径已业务确认/).check();
  await page.getByRole("button", { name: "保存策略" }).click();
  await expect(page.locator(".banner.warn")).toHaveCount(0);
});

test("B2 供应商预设:多阶价格可维护并显示", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/procurement/suppliers");

  await page.getByLabel("MPN", { exact: true }).fill("GRM188R71H104KA93D");
  await page.getByLabel("MOQ", { exact: true }).fill("1000");
  await page.getByLabel("Lead Time(天)").fill("21");
  await page.getByRole("button", { name: "保存预设" }).click();

  const table = page.locator(".card", { hasText: "已维护的供应商预设" }).locator("table.tbl");
  await expect(table).toContainText("GRM188R71H104KA93D");
  await expect(table.locator(".badge").first()).toContainText("≥1");
});

test("PR7 遗留:草稿态不可导出;批准后可从快照导出 XLSX", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await page.goto("/rfq");
  await page.getByLabel("标题").fill("E2E 导出验证");
  await page.getByRole("button", { name: "创建 RFQ" }).click();
  await expect(page).toHaveURL(/\/rfq\/[^/]+$/);

  await page.goto("/quotes");
  await page.getByRole("button", { name: "创建报价" }).click();
  await expect(page).toHaveURL(/\/quotes\/[^/]+$/);

  // 草稿态:明确不可导出
  await expect(page.locator(".card", { hasText: "正式导出" })).toContainText("不可导出");
  await expect(page.getByRole("link", { name: /导出 XLSX/ })).toHaveCount(0);

  await page.getByRole("button", { name: "添加示例行" }).click();
  page.once("dialog", (d) => d.accept("阻容感"));
  await page.getByRole("button", { name: "确认分类" }).first().click();
  await page.getByRole("button", { name: "提交审批" }).click();
  await expect(page.locator(".page-actions .badge")).toHaveText("待审批");

  // 提交后可按提交快照导出
  const link = page.getByRole("link", { name: /导出 XLSX/ });
  await expect(link).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
});
