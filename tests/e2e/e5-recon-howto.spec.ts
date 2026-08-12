import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

/**
 * E5 / 客户 Q11 原话:「没找到入口:此项功能**不知如何实现,需要举例**」。
 *
 * 客户没说功能错 —— 说的是不知道怎么用。所以这一轮**不动对账引擎**,
 * 只验:五步引导在、样例可下载、示例可一键加载,
 * 且**示例数据不污染正式 KPI**。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("五步引导可见,并如实说明基准来源与 ERP 未接入", async ({ page }) => {
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/reconciliation");

  const howTo = page.getByTestId("recon-how-to");
  await expect(howTo).toBeVisible();
  for (const s of ["上传对账单", "系统匹配", "查看差异", "人工确认", "导出结果"]) {
    await expect(howTo).toContainText(s);
  }
  // 七类差异要列出来 —— 客户问的就是"差异长什么样"
  await expect(howTo).toContainText("仅对方有");
  await expect(howTo).toContainText("币种不一致");
  // 诚实 UI:基准来源与 ERP 状态
  await expect(howTo).toContainText("ERP AR/AP 尚未接入");
  await expect(howTo).toContainText("系统已有记录 / 导入数据");
});

test("样例对账单可下载,且带「怎么用」说明页", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/reconciliation");

  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("recon-example-download").click(),
  ]);
  expect(dl.suggestedFilename()).toBe("reconciliation-example-AR.xlsx");

  const wb = new ExcelJS.Workbook();
  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  await wb.xlsx.load(Buffer.concat(chunks) as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const help = JSON.stringify(wb.getWorksheet("怎么用")!.getSheetValues());
  expect(help).toContain("第 1 步");
  expect(help).toContain("第 5 步");
  expect(help).toContain("ERP AR/AP 接入后可自动同步");
  const sample = JSON.stringify(wb.getWorksheet("客户对账单示例")!.getSheetValues());
  expect(sample).toContain("单据号");
  expect(sample).toContain("INV-2026-0001");
});

test("**一键加载示例后带「示例」标记,且不计入未处理差异 KPI**", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/reconciliation");

  const kpiBefore = await page
    .locator(".kpi", { hasText: "未处理差异行" })
    .locator(".kpi-value")
    .innerText();

  await page.getByTestId("recon-example-load").click();
  await expect(page.getByTestId("recon-example-note")).toContainText("不计入正式对账结论", {
    timeout: 30_000,
  });

  // 台账里出现示例并带标记
  const row = page.locator("table.tbl tbody tr").filter({ hasText: "示例-AR-" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("示例 · 不计入正式结论");
  // 示例里确实有差异行(数量差异 / 仅对方有),但 KPI 不能被它抬高
  await expect(row).not.toContainText("0 / 0");

  const kpiAfter = await page
    .locator(".kpi", { hasText: "未处理差异行" })
    .locator(".kpi-value")
    .innerText();
  expect(kpiAfter.trim(), "示例数据不得抬高未处理差异 KPI").toBe(kpiBefore.trim());

  // 对账单数 KPI 也要把示例排除,并单独说明有几张示例
  await expect(page.locator(".kpi", { hasText: "对账单" }).first()).toContainText("示例(不计入)");
});

test("空态引导指向示例入口,而不是只写「暂无对账单」", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/reconciliation");
  const body = page.locator("table.tbl tbody");
  const empty = body.getByText("暂无对账单");
  if ((await empty.count()) > 0) {
    await expect(empty).toContainText("加载示例数据");
  }
});
