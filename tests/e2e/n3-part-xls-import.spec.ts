import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

/**
 * N-3(客户 PR2 反馈 采购-1d:「批量导入物料以附件(比如 xls)选择进行,不以文本形式进行导入」)。
 *
 * 用**真的 xlsx**(exceljs 现场生成)验证,不拿 csv 冒充 —— 客户要的就是 Excel 附件。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function xlsxBuffer(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("物料");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("N-3 上传 xlsx 附件即可批量导入物料,预览不写库", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

  const buf = await xlsxBuffer([
    ["内部料号", "MPN", "制造商", "描述"],
    [`EE-N3-${u}-1`, `N3MPN-${u}-1`, "TI", "N-3 用例"],
    [`EE-N3-${u}-2`, `N3MPN-${u}-2`, "ST", "N-3 用例"],
  ]);

  await page.goto("/materials");
  await page.getByRole("button", { name: "批量导入物料" }).click();
  await page.getByLabel(/选择文件/).setInputFiles({
    name: `n3-${u}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });

  // 预览:必须明说没有写库
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByText(/未创建任何物料/)).toBeVisible({ timeout: 30_000 });

  // 执行:真的建出来
  await page.getByRole("button", { name: "执行导入" }).click();
  await expect(page.getByText(/已创建 2 条/)).toBeVisible({ timeout: 30_000 });

  // 回到列表能搜到 —— 证明是真落库,不是界面上的假成功
  await page.goto(`/materials?q=${encodeURIComponent(`N3MPN-${u}-1`)}`);
  await expect(page.getByText(`N3MPN-${u}-1`).first()).toBeVisible();
});

test("N-3 文件读不出表格时如实报错,不静默当成空导入", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");

  await page.goto("/materials");
  await page.getByRole("button", { name: "批量导入物料" }).click();
  await page.getByLabel(/选择文件/).setInputFiles({
    name: "not-a-table.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]),
  });
  await page.getByRole("button", { name: "预览", exact: true }).click();

  const err = page.locator(".banner.warn").first();
  await expect(err).toBeVisible({ timeout: 30_000 });
  // 不得出现"已创建 0 条"这类把失败说成成功的措辞
  await expect(page.getByText(/已创建/)).toHaveCount(0);
});
