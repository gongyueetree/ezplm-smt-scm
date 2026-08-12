import { expect, test, type Page } from "@playwright/test";

/**
 * E6 / 客户 Q12:「质量事件由**品质**录入」+「没有品质模块,该如何导入质量事件?」。
 *
 * 用例守四条:
 * ① 权限而非角色 —— 没有 quality.view 就看不到内容;
 * ② 客诉必须挂客户、供应商问题必须挂供应商;
 * ③ 页面明说这**不是完整 QMS**;
 * ④ **没有 MES 时粒度一律写"批次级"**,不许出现"SN 级已实现"。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("管理层可登记质量事件;页面明说不是完整 QMS,且粒度写批次级", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/quality");

  /*
   * 定位到页面自己的口径说明块 —— 路由配置里的 desc 也含同样字眼,
   * 裸 getByText 会撞两个元素。
   */
  const scope = page.getByTestId("quality-scope-note");
  await expect(scope).toContainText("不是完整 QMS");
  await expect(scope).toContainText("当前粒度:批次级");
  await expect(scope).toContainText("没有新增「品质」角色");
  // 不许出现"SN 级已实现"这类说法
  expect(await page.getByText(/SN 级追溯已(实现|完成|可用)/).count()).toBe(0);

  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  await page.getByLabel("事件标题").fill(`来料不良 ${tag}`);
  await page.getByLabel("MPN").fill(`QI-MPN-${tag}`);
  await page.getByTestId("quality-submit").click();
  await expect(page.getByTestId("quality-note")).toContainText("已记录", { timeout: 30_000 });

  const row = page.getByTestId("quality-table").locator("tbody tr").filter({ hasText: tag });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("来料异常");
  await expect(row).toContainText("OPEN");
});

test("**客诉必须挂客户,供应商问题必须挂供应商**", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/quality");

  await page.getByLabel("事件类型").selectOption("CUSTOMER_COMPLAINT");
  await page.getByLabel("事件标题").fill("客诉但没选客户");
  await page.getByTestId("quality-submit").click();
  await expect(page.getByTestId("quality-error")).toContainText("必须选择客户", { timeout: 30_000 });

  await page.getByLabel("事件类型").selectOption("SUPPLIER");
  await page.getByTestId("quality-submit").click();
  await expect(page.getByTestId("quality-error")).toContainText("必须选择供应商", { timeout: 30_000 });
});

test("填了 SN 也要提示「系统不产生 SN」—— 不能让人以为 SN 级追溯已就绪", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/quality");
  await expect(page.getByText(/SN 留空是常态/)).toBeVisible();

  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  await page.getByLabel("事件标题").fill(`带 SN ${tag}`);
  await page.getByLabel("SN").fill(`SN-${tag}`);
  await page.getByTestId("quality-submit").click();
  await expect(page.getByTestId("quality-note")).toContainText("系统不产生 SN", { timeout: 30_000 });
});

test("没有 quality.view 权限的账号看不到内容,而是被明确告知缺什么权限", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/quality");
  await expect(page.getByTestId("quality-no-permission")).toContainText("quality.view");
  await expect(page.getByTestId("quality-table")).toHaveCount(0);
});
