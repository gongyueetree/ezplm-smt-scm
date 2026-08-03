import fs from "fs";
import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * BOM 台账整改 E2E(客户 docx 对 BOM 管理页的逐条意见):
 * - 新增卡片:EOL 物料占用 BOM、超期未更新 BOM;
 * - KPI 风险色标 + 点卡片自动下钻(不必二次筛选);
 * - 客户/时间/超期口径组合筛选;
 * - 批量导出 BOM 清单与异常物料;
 * - 导入历史台账;导入完成后可直接去比对。
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

test("BOM 台账:新增两张卡片、风险色标、点卡片自动下钻", async ({ page }) => {
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/bom");

  await expect(page.locator(".kpi", { hasText: "EOL 物料占用 BOM" })).toBeVisible();
  await expect(page.locator(".kpi", { hasText: "超期未更新 BOM" })).toBeVisible();
  await expect(page.locator(".kpi", { hasText: "需人工确认物料" })).toBeVisible();
  await expect(page.locator(".kpi", { hasText: "未识别物料" })).toBeVisible();

  // 生命周期未知不算 EOL,且要如实说明覆盖面
  await expect(page.getByText(/生命周期未知不算 EOL/)).toBeVisible();
  await expect(page.getByText(/该口径未经业务确认/)).toBeVisible();

  // 点卡片下钻:URL 带 focus,列表标题显示已下钻
  await page.locator(".kpi", { hasText: "需人工确认物料" }).click();
  await expect(page).toHaveURL(/focus=unconfirmed/);
  await expect(page.getByText(/已下钻:有待人工确认行/)).toBeVisible();

  // 清除下钻
  await page.locator(".kpi", { hasText: "BOM 总数" }).click();
  await expect(page).not.toHaveURL(/focus=/);
});

test("BOM 台账:超期口径可调,调整后立即影响判定", async ({ page }) => {
  await login(page, "pm@demo.qianchuang.cn");
  // 口径设成 0 天 → 任何有版本的 BOM 都算超期(用于验证口径真的参与计算)
  await page.goto("/bom?staleDays=1");
  const staleKpi = page.locator(".kpi", { hasText: "超期未更新 BOM" });
  await expect(staleKpi).toContainText("超过 1 天");
  const aggressive = Number((await staleKpi.locator(".kpi-value").innerText()).trim());

  await page.goto("/bom?staleDays=3650");
  await expect(page.locator(".kpi", { hasText: "超期未更新 BOM" })).toContainText("超过 3650 天");
  const lenient = Number(
    (await page.locator(".kpi", { hasText: "超期未更新 BOM" }).locator(".kpi-value").innerText()).trim(),
  );
  expect(aggressive).toBeGreaterThanOrEqual(lenient);
});

test("BOM 台账:批量导出清单与异常物料", async ({ page }) => {
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/bom");

  for (const [name, pattern] of [
    ["批量导出清单", /^bom-list\.xlsx$/],
    ["批量导出异常物料", /^bom-issues\.xlsx$/],
  ] as const) {
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(pattern);
  }
});

test("导入历史台账:可追溯原始文件,并能直达匹配确认", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.qianchuang.cn");

  // 幂等键算的是**文件内容 + 解析结果**,只改文件名照样命中复用、不产生新作业行。
  // 所以这里连内容也要唯一(加一行独有位号),否则台账里最新一条会是旧记录。
  const stamp = Date.now();
  const uniqueName = `e2e-ledger-${stamp}.csv`;
  const content = `${fs.readFileSync(BOM_FIXTURE, "utf8")}\nU${stamp % 100000},1,TI,SN74LVC1G08DBVR,SOT-23-5,唯一化用行\n`;
  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles({
    name: uniqueName,
    mimeType: "text/csv",
    buffer: Buffer.from(content, "utf8"),
  });
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });

  // 导入完成页应给出「与其它版本比对」入口,并说明为什么不预设上一版本
  await expect(page.getByRole("link", { name: "与其它版本比对" })).toBeVisible();
  await expect(page.getByText(/每次导入都会新建一个 BOM/)).toBeVisible();

  await page.goto("/bom/imports");
  await expect(page.locator(".page-title")).toHaveText("导入历史");
  // 按文件名定位,不用"第一行"——并行用例可能插队
  const row = page.locator("table.tbl tbody tr").filter({ hasText: uniqueName });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("link", { name: "匹配确认" })).toBeVisible();
  // 幂等复用要如实说明,不能让人以为每次都产生了新版本
  await expect(page.getByText(/幂等键/)).toBeVisible();
});

test("导入后「与其它版本比对」:新版本被预选为变更后,再挑变更前", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles(BOM_FIXTURE);
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: "与其它版本比对" }).click();
  await expect(page).toHaveURL(/\/bom\/compare\?to=/);
  await expect(page.getByText(/已把刚导入的版本选为/)).toBeVisible();
  // 表里可一键把某个版本选为「变更前」
  await page.getByRole("link", { name: "选为变更前" }).first().click();
  await expect(page).toHaveURL(/from=.*&to=/);
  await expect(page.getByText("差异明细")).toBeVisible();
});
