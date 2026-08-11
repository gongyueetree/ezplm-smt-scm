import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

/**
 * N-9(客户 PR2 反馈 采购-6):
 *   A「是否应用到 PO 中?」→ 已应用,页面上写清楚;
 *   B「需要批量导入」→ 本用例;
 *   C 阶梯价分行 → 已在 D-2 完成。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function xlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("预设");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const HEAD = ["供应商编码", "MPN", "制造商", "币种", "MOQ", "SPQ", "交期", "起订数量", "单价"];

/** 取页面上真实存在的一个供应商编码 —— 不写死,种子数据可能变 */
async function firstSupplierCode(page: Page): Promise<string> {
  await page.goto("/procurement/suppliers");
  const opt = page.locator("select option").first();
  const label = (await opt.textContent()) ?? "";
  return label.split("·")[0].trim();
}

test("N-9 上传 xlsx 批量导入供应商预设:预览不写库,执行后可见", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "procurement@demo.qianchuang.cn");
  const code = await firstSupplierCode(page);
  test.skip(!code, "库里没有供应商");
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const mpn = `N9-${u}`;

  // 同一料两档价写成两行 —— 客户要的"分行"口径
  const buf = await xlsx([
    HEAD,
    [code, mpn, "ST", "CNY", 100, 100, 21, 1, "12.5"],
    [code, mpn, "ST", "CNY", 100, 100, 21, 1000, "11.8"],
  ]);

  await page.getByRole("button", { name: "批量导入供应商预设" }).click();
  await page.getByLabel("选择文件").setInputFiles({
    name: `n9-${u}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });

  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByTestId("offer-import-note")).toContainText("未写入任何供应商预设");
  // 两行合成一组、两档价
  const plan = page.getByTestId("offer-import-plan");
  await expect(plan).toContainText(mpn);
  await expect(plan).toContainText("将写入");

  await page.getByRole("button", { name: "执行导入" }).click();
  await expect(page.getByTestId("offer-import-note")).toContainText("已写入 1 条");

  // 真落库:预设列表里能看到
  await expect(
    page.locator(".card", { hasText: "已维护的供应商预设" }).locator("table.tbl"),
  ).toContainText(mpn);
});

test("N-9 供应商编码不存在时拦下,**不自动创建供应商**", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/procurement/suppliers");
  const u = Date.now().toString(36).toUpperCase();

  const buf = await xlsx([HEAD, [`NOSUCH-${u}`, `X-${u}`, "", "CNY", "", "", "", 1, "1.0"]]);
  await page.getByRole("button", { name: "批量导入供应商预设" }).click();
  await page.getByLabel("选择文件").setInputFiles({
    name: `bad-${u}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });
  await page.getByRole("button", { name: "预览", exact: true }).click();

  const errs = page.getByTestId("offer-import-errors");
  await expect(errs).toBeVisible();
  await expect(errs).toContainText("不存在");
  await expect(errs).toContainText("不会自动创建");
  // 有错时不允许执行
  await expect(page.getByRole("button", { name: "执行导入" })).toBeDisabled();
});

test("N-9.A 页面必须说清采购策略已应用到 PO", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/procurement/suppliers");
  const note = page.getByTestId("policy-scope-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("已应用到采购订单");
});
