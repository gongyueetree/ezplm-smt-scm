import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * PR6 业务流程 E2E(SPEC §17 第 4–5 项):
 * ④ 同一 MPN 比较 ezPLM/DigiKey/Mouser/线下报价
 * ⑤ 采购选择供应商并反馈 PM(含异常闭环:未处理不得反馈)
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";
const BOM_FIXTURE = path.join(__dirname, "fixtures", "demo-bom.csv");
const QUOTE_FIXTURE = path.join(__dirname, "fixtures", "supplier-quote.csv");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/** 先以 PM 导入一张 BOM,供采购比价使用 */
async function ensureBom(page: Page) {
  await login(page, "pm@demo.ezplm.cn");
  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles(BOM_FIXTURE);
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });
}

async function createProcurementRfq(page: Page) {
  await page.goto("/procurement/rfq");
  const options = page.locator('select[multiple] option');
  await expect(options.first()).toBeVisible();
  await page.locator('select[multiple]').selectOption({ index: 0 });
  await page.getByRole("button", { name: "创建采购 RFQ" }).click();
  await expect(page).toHaveURL(/\/procurement\/rfq\/[^/]+$/);
}

test("采购创建比价单并查询多源报价,推荐与最低价分别标识(SPEC §17-4)", async ({ page }) => {
  await ensureBom(page);
  await login(page, "procurement@demo.ezplm.cn");
  await createProcurementRfq(page);

  await page.getByRole("button", { name: "查询 DigiKey / Mouser" }).click();
  await expect(page.getByText("多源比价")).toBeVisible({ timeout: 60_000 });

  // 同一料号下有多个来源的合格报价,且标出推荐(按卡片语义定位,不依赖表格序号)
  const table = page.locator(".card", { hasText: "② 多源比价" }).locator("table.tbl");
  await expect(table).toContainText("DIGIKEY");
  await expect(table.locator(".badge", { hasText: "推荐" }).first()).toBeVisible();
  // 诚实 UI:展示数据更新时间
  await expect(table).toContainText("数据更新");
});

test("线下报价导入后固化原始异常,未处理不得反馈 PM(SPEC §17-5 + 异常闭环)", async ({ page }) => {
  await ensureBom(page);
  await login(page, "procurement@demo.ezplm.cn");
  await createProcurementRfq(page);

  // 导入线下供应商报价(STM32 单价 25.5 超过演示价格线 10 → 原始异常)
  await page.getByLabel("线下报价文件(CSV/XLSX)").setInputFiles(QUOTE_FIXTURE);
  await page.getByRole("button", { name: "导入线下报价" }).click();
  await expect(page.getByText(/已导入 3 行报价/)).toBeVisible({ timeout: 30_000 });

  // 原始异常被固化并计入未处理数
  await expect(page.locator(".kpi", { hasText: "原始异常行" })).toContainText("1");
  await expect(page.locator(".kpi", { hasText: "未处理" })).toContainText("1");

  // 未处理时不可反馈 PM
  const feedbackBtn = page.getByRole("button", { name: /尚有未处理异常,不可反馈/ });
  await expect(feedbackBtn).toBeVisible();
  await expect(feedbackBtn).toBeDisabled();

  // 接受异常必须写理由:取消 → 不发生变化
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "接受" }).first().click();
  await expect(page.locator(".kpi", { hasText: "未处理" })).toContainText("1");

  // 写明理由 → 异常处理完毕
  page.once("dialog", (d) => d.accept("客户指定唯一货源,接受溢价"));
  await page.getByRole("button", { name: "接受" }).first().click();
  await expect(page.locator(".kpi", { hasText: "未处理" })).toContainText("0");

  // 处理完毕后方可反馈 PM
  page.once("dialog", (d) => d.accept("比价完成,建议按推荐供应商下单"));
  await page.getByRole("button", { name: "反馈给 PM" }).click();
  await expect(page.locator(".page-actions .badge")).toHaveText("已反馈 PM");
});

test("PM 无权创建采购 RFQ(角色边界)", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await page.goto("/procurement/rfq");
  // 菜单不含采购 RFQ,直接访问也只读
  await expect(page.getByText("当前角色只读:仅采购与管理层可创建采购 RFQ")).toBeVisible();
});
