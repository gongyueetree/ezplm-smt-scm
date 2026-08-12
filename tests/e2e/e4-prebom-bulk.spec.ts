import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

/**
 * E4 / 客户 Q9:「**预 BOM 的批量导入导出**需要输入口」。
 *
 * 用例守三条:
 * ① 一次多个文件,**每个文件各自生成一份预 BOM**(不合并);
 * ② 一个文件失败**不拖垮其它文件**;
 * ③ 导出带**导入状态与待人工判断行数** —— 导出的不等于干净数据。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

function uniqueTag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function bomXlsx(tag: string, n: number, extraJunk = false): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOM");
  ws.addRow(["位号", "用量", "制造商", "制造商料号", "封装", "描述"]);
  for (let i = 1; i <= n; i++) {
    ws.addRow([`R${i}`, 1, "Yageo", `${tag}-MPN-${i}`, "0603", `描述 ${i}`]);
  }
  // 混一行"无料号无位号" —— 用来验证待人工判断计数确实传到了导出
  if (extraJunk) ws.addRow(["", "", "", "", "", "附注:这一行没有料号也没有位号"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("一次多个文件:每个文件各自生成一份预 BOM,坏文件不拖垮好文件", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const tag = uniqueTag();

  await page.goto("/bom");
  await page.getByLabel("预 BOM 批量导入文件").setInputFiles([
    { name: `${tag}-A.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await bomXlsx(`${tag}A`, 5) },
    { name: `${tag}-B.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await bomXlsx(`${tag}B`, 3, true) },
    // 认不出必需列的文件 —— 必须只失败它自己
    { name: `${tag}-BAD.csv`, mimeType: "text/csv", buffer: Buffer.from("随便,写点,什么\n1,2,3\n", "utf-8") },
  ]);
  await page.getByTestId("pre-bom-import").click();

  const table = page.getByTestId("pre-bom-results");
  await expect(table).toBeVisible({ timeout: 120_000 });
  await expect(table.locator("tbody tr")).toHaveCount(3);

  const rowA = table.locator("tbody tr").filter({ hasText: `${tag}-A.xlsx` });
  const rowB = table.locator("tbody tr").filter({ hasText: `${tag}-B.xlsx` });
  const rowBad = table.locator("tbody tr").filter({ hasText: `${tag}-BAD.csv` });
  await expect(rowA).toContainText("已导入");
  await expect(rowB).toContainText("已导入");
  await expect(rowBad).toContainText("失败");
  // 失败要说清原因,而不是只有一个"失败"
  await expect(rowBad).toContainText("必需列");

  // 回执必须点明用途固定为预 BOM
  await expect(page.getByTestId("pre-bom-note")).toContainText("预 BOM");

  // 台账里两份各自独立存在,且都是预 BOM
  await page.goto("/bom?purpose=PRE_QUOTE");
  const ledger = page.locator("table.tbl tbody");
  await expect(ledger).toContainText(`${tag}-A.xlsx`);
  await expect(ledger).toContainText(`${tag}-B.xlsx`);
});

test("批量导出附带导入状态与待人工判断行数", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const tag = uniqueTag();

  await page.goto("/bom");
  await page.getByLabel("预 BOM 批量导入文件").setInputFiles([
    { name: `${tag}-X.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await bomXlsx(`${tag}X`, 4, true) },
  ]);
  await page.getByTestId("pre-bom-import").click();
  await expect(page.getByTestId("pre-bom-results")).toBeVisible({ timeout: 120_000 });

  await page.reload();
  await page.getByLabel("批量导出 BOM 选择").selectOption({ label: `${tag}-X.xlsx · 4 行` });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("pre-bom-export").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^pre-boms-\d+\.xlsx$/);

  const wb = new ExcelJS.Workbook();
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  await wb.xlsx.load(Buffer.concat(chunks) as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const summary = JSON.stringify(wb.getWorksheet("导出说明")!.getSheetValues());
  expect(summary).toContain("待人工判断");
  expect(summary).toContain("行去向已对平");
  expect(summary).toContain("导出的不等于干净数据");

  // 明细保留客户原始字段
  const detail = JSON.stringify(wb.getWorksheet("BOM 明细")!.getSheetValues());
  expect(detail).toContain(`${tag}X-MPN-1`);
  expect(detail).toContain("Yageo");
  expect(detail).toContain("客户料号");
});
