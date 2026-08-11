import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * 齐料检查 / 缺料分析 / 物料查询 E2E。
 * 重点验证「数据未知不得当作有货」这条诚实纪律在 UI 上真的可见。
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";
const BOM_FIXTURE = path.join(__dirname, "fixtures", "demo-bom.csv");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/**
 * 导入 CSV 夹具并**返回该版本 id**。
 *
 * 为什么不能"库里有 BOM 就跳过":其它用例(如图片/PDF 导入)也会建 BOM,
 * 页面默认取**最新**版本 —— 配上模型凭据后图片识别真的建出了 2 行的 BOM,
 * 于是齐料/缺料用例断言的行直接消失。用例必须自建前置数据并锁定版本号。
 */
async function importBomFixture(page: Page): Promise<string> {
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

/**
 * S-5:齐料检查已并入缺料分析(两页入参与算法完全相同)。
 *
 * 本用例随之改为验证**合并后的结果**,而不是迁就实现:
 * ① /kitting 仍可访问(书签不 404),但会重定向到 /shortage,**查询参数不丢**;
 * ② 齐套率这个指标必须被带过去 —— 合并不能变成删指标;
 * ③ 「数据未知」仍用文字而非 0 表达。
 */
test("齐料检查已并入缺料分析:重定向保参数,且齐套率没有丢", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  const versionId = await importBomFixture(page);

  await page.goto(`/kitting?v=${versionId}&boards=100`);

  // 重定向到缺料分析,且 v / boards 原样带过去(否则书签点开是空页)
  await expect(page).toHaveURL(new RegExp(`/shortage\\?.*v=${versionId}.*boards=100`));
  await expect(page.locator(".page-title")).toHaveText("缺料分析");

  // 齐套率必须在 —— 它原本只在齐料检查页,合并时不能丢
  await expect(page.locator(".kpi .kpi-label", { hasText: /^齐套率$/ })).toBeVisible();
  await expect(page.locator(".kpi .kpi-label", { hasText: /^数据未知行$/ })).toBeVisible();

  // 损耗率口径提示
  await expect(page.locator(".banner")).toContainText("口径待甲方确认");
});

test("缺料分析:Call 料表把数据未知行排在最前", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  const versionId = await importBomFixture(page);

  await page.goto(`/shortage?v=${versionId}&boards=100`);
  await expect(page.locator(".page-title")).toHaveText("缺料分析");
  await expect(page.locator(".banner")).toContainText("排在最前");

  const table = page.locator(".card", { hasText: "Call 料表" }).locator("table.tbl");
  await expect(table).toBeVisible();

  // 首行应为「数据未知」(demo BOM 里有主数据不存在的料)
  const firstBadge = table.locator("tbody tr").first().locator(".badge");
  await expect(firstBadge).toHaveText("数据未知");
});

test("Call 料表可导出 XLSX", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  const versionId = await importBomFixture(page);
  await page.goto(`/shortage?v=${versionId}&boards=100`);

  const link = page.getByRole("link", { name: /导出 Call 料表/ });
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/^call-list-.*\.xlsx$/);
});

test("物料查询:可按关键字检索并显示数据更新时间", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/materials");
  await expect(page.locator(".page-title")).toHaveText("物料查询");

  await page.getByLabel(/关键字/).fill("STM32");
  await page.getByRole("button", { name: "查询" }).click();

  const table = page.locator(".card", { hasText: "查询结果" }).locator("table.tbl");
  await expect(table).toContainText("STM32F103C8T6");
  await expect(table).toContainText("ACTIVE");
  // 诚实 UI:表头含数据更新时间
  await expect(table).toContainText("数据更新");

  // EOL 料被标红(demo 数据含 MAX232CPE)
  await page.getByLabel(/关键字/).fill("MAX232");
  await page.getByRole("button", { name: "查询" }).click();
  // 查询是整页导航:先等 URL 真的变了,再等新结果集落地。
  // 只等内容的话,并发跑满时会在旧表格上超时,看起来像功能坏了。
  await page.waitForURL(/[?&]q=MAX232/, { timeout: 30_000 });
  await expect(table).toContainText("MAX232CPE", { timeout: 30_000 });
  await expect(table.locator(".badge", { hasText: "EOL" })).toBeVisible({ timeout: 15_000 });
});
