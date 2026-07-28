import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Backlog B4 / B5 / B6 E2E:
 * B5 线下报价导入识别 MOQ/SPQ/LT/币种
 * B4 多源询价分批(不再静默截断)
 * B6 报价打印视图(只读快照)
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

async function ensureBom(page: Page) {
  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles(BOM_FIXTURE);
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });
}

async function createProcurementRfq(page: Page) {
  await page.goto("/procurement/rfq");
  await expect(page.locator("select[multiple] option").first()).toBeVisible();
  await page.locator("select[multiple]").selectOption({ index: 0 });
  await page.getByRole("button", { name: "创建采购 RFQ" }).click();
  await expect(page).toHaveURL(/\/procurement\/rfq\/[^/]+$/);
}

test("B5 线下报价导入识别 MOQ/SPQ/Lead Time 并回显列映射", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await ensureBom(page);
  await login(page, "procurement@demo.ezplm.cn");
  await createProcurementRfq(page);

  await page.getByLabel("线下报价文件(CSV/XLSX)").setInputFiles(QUOTE_FIXTURE);
  await page.getByRole("button", { name: "导入线下报价" }).click();

  const info = page.locator(".banner.info");
  await expect(info).toContainText("已导入 3 行报价", { timeout: 30_000 });
  // B5 核心:MOQ / SPQ / Lead Time 都被识别出来
  await expect(info).toContainText("MOQ");
  await expect(info).toContainText("SPQ");
  await expect(info).toContainText("Lead Time");

  // 交期已解析(8 周 = 56 天,超过默认 30 天交期线 → 该行应被标为原始异常)
  await expect(page.locator(".kpi", { hasText: "原始异常行" })).not.toContainText("0");
});

test("B4 多源询价分批推进,进度跑到 100% 且不截断", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await ensureBom(page);
  await login(page, "procurement@demo.ezplm.cn");
  await createProcurementRfq(page);

  await page.getByRole("button", { name: "查询 DigiKey / Mouser" }).click();

  // 分批进度条出现并跑到完成
  await expect(page.getByText(/询价进度/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/询价进度.*· 已完成/)).toBeVisible({ timeout: 120_000 });

  // 比价结果覆盖 BOM 里全部有 MPN 的料号(demo BOM 为 4 行)
  const rows = page.locator(".card", { hasText: "② 多源比价" }).locator("table.tbl tbody tr");
  await expect(rows).toHaveCount(4);
});

test("B6 报价打印视图只读快照:草稿态拒绝,提交后可打印", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");

  // 建 RFQ 与报价
  await page.goto("/rfq");
  await page.getByLabel("标题").fill(`E2E 打印视图 ${Date.now()}`);
  await page.getByRole("button", { name: "创建 RFQ" }).click();
  await expect(page).toHaveURL(/\/rfq\/[^/]+$/);

  await page.goto("/quotes");
  await page.getByRole("button", { name: "创建报价" }).click();
  await expect(page).toHaveURL(/\/quotes\/[^/]+$/);
  const versionId = page.url().split("/").pop()!;

  // 草稿态:无快照 → 打印页明确拒绝,不用实时数据凑
  await page.goto(`/quotes/${versionId}/print`);
  await expect(page.getByText("无法生成正式报价单")).toBeVisible();
  await expect(page.getByText(/不会用实时数据重算充当正式报价单/)).toBeVisible();

  // 提交审批后有提交快照
  await page.goto(`/quotes/${versionId}`);
  await page.getByRole("button", { name: "添加示例行" }).click();
  page.once("dialog", (d) => d.accept("阻容感"));
  await page.getByRole("button", { name: "确认分类" }).first().click();
  await page.getByRole("button", { name: "提交审批" }).click();
  await expect(page.locator(".page-actions .badge")).toHaveText("待审批");

  await page.goto(`/quotes/${versionId}/print`);
  await expect(page.locator("h1")).toHaveText("报价单");
  await expect(page.getByText("提交快照(submittedSnapshot)")).toBeVisible();
  await expect(page.getByRole("button", { name: /打印 \/ 另存为 PDF/ })).toBeVisible();
  // 金额来自快照
  await expect(page.getByText("总价")).toBeVisible();
  await expect(page.locator(".print-doc")).toContainText("92.00");
});
