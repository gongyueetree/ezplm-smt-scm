import { expect, test, type Page } from "@playwright/test";

/**
 * 批次5 E2E:A/B/C 客户分级 + 多套报价模板预设。
 *
 * 锁住的纪律:
 * - 系统**不预设任何百分比**;默认 Markup 未维护时如实说"需人工填写",不编数字;
 * - **客户未评级 ≠ C 级**;
 * - 口径未确认的模板照样能用,但全程标注「待确认」。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("模板页:系统不预设百分比,未评级客户明确落通用模板", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/quote-templates");

  await expect(page.getByText(/系统不预设任何百分比/)).toBeVisible();
  await expect(page.getByText(/客户未评级 ≠ C 级/)).toBeVisible();
});

test("新建模板:留空 Markup 显示「未维护」,未确认口径全程标注", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/quote-templates");

  const name = `E2E通用-${Date.now()}`;
  await page.getByLabel("模板名称").fill(name);
  // 等级留空 = 通用;Markup 留空 = 未维护;不勾确认
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByTestId("tpl-msg")).toContainText("已创建模板");

  // 按卡片收窄:模板名还会出现在「客户等级与命中的模板」表的命中说明里
  // (如「回落通用模板「E2E通用-…」」),不收窄会匹配到多行
  const row = page
    .locator(".card", { hasText: "报价模板" })
    .locator("tbody tr")
    .filter({ hasText: name });
  await expect(row).toContainText("未维护");
  await expect(row).toContainText("口径待确认");
  await expect(row).toContainText("通用");
});

test("客户等级可设置,且未评级时命中说明写明不等于 C 级", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/quote-templates");

  // 先确保有一套通用模板可回落
  const generic = `E2E回落-${Date.now()}`;
  await page.getByLabel("模板名称").fill(generic);
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByTestId("tpl-msg")).toContainText("已创建模板");

  // 用 testid 而不是标签文本:「等级」会同时匹配模板表单里的「适用等级」,
  // 而 getByLabel 在这种嵌套 label 结构下也不稳
  const tierSelect = page.getByTestId("customer-tier-select");
  await tierSelect.selectOption("");
  await page.getByRole("button", { name: "保存等级" }).click();
  await expect(page.getByTestId("tier-msg")).toContainText("已保存");

  const table = page.locator(".card", { hasText: "客户等级与命中的模板" });
  await expect(table.getByText("未评级").first()).toBeVisible();
  await expect(table.getByText(/尚未评级/).first()).toBeVisible();
  await expect(table.getByText(/不等于 C 级/).first()).toBeVisible();

  // 设为 A 类后,命中说明应变成等级匹配或回落
  await tierSelect.selectOption("A");
  await page.getByRole("button", { name: "保存等级" }).click();
  await expect(page.getByTestId("tier-msg")).toContainText("已保存");
  await expect(table.getByText("A 类").first()).toBeVisible();
});
