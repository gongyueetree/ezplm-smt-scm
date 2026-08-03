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

/**
 * 先以 PM 导入一张 BOM,并**返回该版本 id**。
 *
 * 必须锁定自己导入的版本:并行 worker 与其它用例(图片/PDF 导入)也会建 BOM,
 * 取"最新一个"会拿到别人的数据 —— 实测配上模型凭据后图片识别真的建出了别的 BOM,
 * 本用例的比价表当场变空。
 */
async function importBomFixture(page: Page): Promise<string> {
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles(BOM_FIXTURE);
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });
  const href = await page
    .getByRole("link", { name: /进入匹配确认/ })
    .first()
    .getAttribute("href");
  const id = href?.split("/").pop();
  expect(id, "导入后应能拿到 BOM 版本 id").toBeTruthy();
  return id!;
}

async function createProcurementRfq(page: Page, bomVersionId?: string) {
  await page.goto("/procurement/rfq");
  const options = page.locator('select[multiple] option');
  await expect(options.first()).toBeVisible();
  await page
    .locator('select[multiple]')
    .selectOption(bomVersionId ? { value: bomVersionId } : { index: 0 });
  await page.getByRole("button", { name: "创建采购 RFQ" }).click();
  await expect(page).toHaveURL(/\/procurement\/rfq\/[^/]+$/);
}

test("采购创建比价单并查询多源报价,推荐与最低价分别标识(SPEC §17-4)", async ({ page }) => {
  // 配置真实 DigiKey/Mouser 凭据时,每个料号要串行打两次外网 API,
  // 分批询价耗时远超默认 30s —— 放宽本例超时,而不是把断言改松。
  test.setTimeout(300_000);
  const bomVersionId = await importBomFixture(page);
  await login(page, "procurement@demo.qianchuang.cn");
  await createProcurementRfq(page, bomVersionId);

  await page.getByRole("button", { name: "查询 DigiKey / Mouser" }).click();
  await expect(page.getByText("多源比价")).toBeVisible({ timeout: 60_000 });

  // B4 分批:表格是逐批填充的,必须等进度跑到「已完成」再断言,
  // 否则断言的是空表(Mock 模式瞬时完成会掩盖这个竞态)。
  await expect(page.locator("p", { hasText: "询价进度" })).toContainText("已完成", {
    timeout: 240_000,
  });

  const table = page.locator(".card", { hasText: "② 多源比价" }).locator("table.tbl");

  // ⚠ 断言落在**系统行为**上,不绑死某一家外部数据源。
  // 实测踩过:DigiKey 日配额 1000 次用尽后返回 429,页面如实显示「无合格报价」——
  // 系统降级是对的,但原来写死 toContainText("DIGIKEY") 的断言会红,
  // 等于把"外部配额可用"当成了被测对象。
  const text = (await table.innerText()).toUpperCase();
  const hasOffers = text.includes("DIGIKEY") || text.includes("MOUSER");

  if (hasOffers) {
    // 有报价:必须标出推荐,并诚实展示数据更新时间
    await expect(table.locator(".badge", { hasText: "推荐" }).first()).toBeVisible();
    await expect(table).toContainText("数据更新");
  } else {
    // 无报价:必须**如实说明**,绝不能编造数据或显示空白
    await expect(table).toContainText("无合格报价");
    // 降级原因要能看到,不是静默失败
    await expect(
      page.getByText(/降级|配额|限流|未返回/).first(),
    ).toBeVisible({ timeout: 10_000 });
  }
});

test("线下报价导入后固化原始异常,未处理不得反馈 PM(SPEC §17-5 + 异常闭环)", async ({ page }) => {
  const bomVersionId = await importBomFixture(page);
  await login(page, "procurement@demo.qianchuang.cn");
  await createProcurementRfq(page, bomVersionId);

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
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/procurement/rfq");
  // 菜单不含采购 RFQ,直接访问也只读
  await expect(page.getByText("当前角色只读:仅采购与管理层可创建采购 RFQ")).toBeVisible();
});
