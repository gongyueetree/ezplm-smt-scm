import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

/**
 * PR-B / PR2-PROC-10:缺料单驱动 + Call 料。
 *
 * 客户原话:「缺料分析是根据**缺料分析单**来的,而非 BOM」、
 * 「已经处理过的显示处理过」。
 *
 * 邮件通道未接通(SMTP 待客户提供),所以本用例**显式断言界面不出现「已发送」**。
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
  const ws = wb.addWorksheet("缺料单");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const HEAD = ["客户", "内部料号", "制造商", "MPN", "需求数量", "可用库存", "在途", "供应商", "ETA", "缺口数量", "需求日期"];

test("PR2-PROC-10 缺料单驱动:导入 → 处理台出现该行 → Call 料 → 状态变「已建 Call 料」", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "procurement@demo.qianchuang.cn");
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const mpn = `PRB-${u}`;

  const buf = await xlsx([
    HEAD,
    ["联创科技", `EE-${u}`, "ST", mpn, 1000, 300, 200, "", "2026-09-01", 500, "2026-08-20"],
  ]);

  await page.goto("/shortage");
  await page.getByLabel("选择文件").setInputFiles({
    name: `ss-${u}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });

  // 预览:必须明说没有创建
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByTestId("sheet-import-note")).toContainText("未创建任何缺料单", { timeout: 30_000 });

  await page.getByRole("button", { name: "执行导入" }).click();
  await expect(page.getByTestId("sheet-import-note")).toContainText("已导入缺料单", { timeout: 30_000 });

  // 处理台出现该行,状态「待处理」
  const table = page.getByTestId("shortage-sheet-lines");
  const row = table.locator("tbody tr").filter({ hasText: mpn });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("待处理");
  // 缺口以单据为准:1000-300-200=500,单据也是 500
  await expect(row).toContainText("500");

  // Call 料
  page.on("dialog", (d) => void d.accept("500"));
  await row.getByRole("button", { name: "Call 料" }).click();
  await expect(page.getByTestId("shortage-sheet-lines").locator("tbody tr").filter({ hasText: mpn }))
    .toContainText("已建 Call 料", { timeout: 30_000 });
});

test("PR2-PROC-10 Call 料后只显示「待发送」,**绝不显示「已发送」**", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "procurement@demo.qianchuang.cn");
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const mpn = `PRBS-${u}`;

  const buf = await xlsx([HEAD, ["", "", "", mpn, 100, "", "", "", "", 100, ""]]);
  await page.goto("/shortage");
  await page.getByLabel("选择文件").setInputFiles({
    name: `ss2-${u}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByTestId("sheet-import-note")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "执行导入" }).click();
  await expect(page.getByTestId("sheet-import-note")).toContainText("已导入", { timeout: 30_000 });

  page.on("dialog", (d) => void d.accept("100"));
  const table = page.getByTestId("shortage-sheet-lines");
  await table.locator("tbody tr").filter({ hasText: mpn }).getByRole("button", { name: "Call 料" }).click();

  // 回执必须说草稿、未发送
  const note = page.locator(".banner").filter({ hasText: /邮件草稿/ }).first();
  await expect(note).toBeVisible({ timeout: 30_000 });
  await expect(note).toContainText("尚未发送");

  // 全页不得出现「已发送」这种完成态
  expect(await page.getByText("已发送", { exact: true }).count()).toBe(0);
});

test("PR2-PROC-10 Call 料数量不得超过缺口", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "procurement@demo.qianchuang.cn");
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const mpn = `PRBX-${u}`;

  const buf = await xlsx([HEAD, ["", "", "", mpn, 100, "", "", "", "", 50, ""]]);
  await page.goto("/shortage");
  await page.getByLabel("选择文件").setInputFiles({
    name: `ss3-${u}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByTestId("sheet-import-note")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "执行导入" }).click();
  await expect(page.getByTestId("sheet-import-note")).toContainText("已导入", { timeout: 30_000 });

  // 缺口 50,却要 999
  page.on("dialog", (d) => void d.accept("999"));
  await page
    .getByTestId("shortage-sheet-lines")
    .locator("tbody tr")
    .filter({ hasText: mpn })
    .getByRole("button", { name: "Call 料" })
    .click();

  const err = page.locator(".banner.warn[role=alert]").first();
  await expect(err).toBeVisible({ timeout: 30_000 });
  await expect(err).toContainText("超过缺口");
});

test("PR2-PROC-10 处理台不显示位号、不显示「建议采购」", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/shortage");
  const head = page.getByTestId("shortage-sheet-lines").locator("thead");
  await expect(head).not.toContainText("位号");
  await expect(head).not.toContainText("建议采购");
  // 客户点名要的列都在
  for (const col of ["客户", "内部料号", "制造商", "MPN", "可用库存", "在途", "供应商", "ETA", "缺口", "需求日期", "状态"]) {
    await expect(head).toContainText(col);
  }
});

test("PR2-PROC-10 页面必须区分「缺料单」与「按 BOM 推算」两套口径", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/shortage");
  await expect(page.getByText(/按 BOM × 台数推算/)).toBeVisible();
  await expect(page.getByText(/不是一回事/)).toBeVisible();
});
