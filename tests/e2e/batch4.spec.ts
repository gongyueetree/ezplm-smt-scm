import { expect, test, type Page } from "@playwright/test";

/**
 * 批次4 E2E:
 * - 批量 update 报价(客户 xlsx 新增需求:批量导入 BOM,逐个生成 update 报价单);
 * - 损耗报告(客户 xlsx 两条原标注均为「无」:筛选分析 + 按客户模板导出)。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("批量 update 报价:逐 BOM 独立成败,失败逐条给出原因", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/quotes");

  await page.getByRole("button", { name: "批量 update 报价" }).click();
  // 语义要写明:已有报价开新 Revision,没有才新建
  await expect(page.getByText(/已有报价的 BOM 开新 Revision/)).toBeVisible();
  await expect(page.getByText(/一条失败不影响其它/)).toBeVisible();

  const boxes = page.locator('input[type="checkbox"]');
  const n = await boxes.count();
  test.skip(n === 0, "库里没有 BOM 版本可选");
  await boxes.first().check();
  if (n > 1) await boxes.nth(1).check();

  await page.getByRole("button", { name: /生成 \/ 更新 \d+ 个报价/ }).click();

  const results = page.getByTestId("batch-update-results");
  await expect(results).toBeVisible({ timeout: 60_000 });
  // 每行要么成功要么给出失败原因,不允许既不成功也不说为什么
  const rows = results.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);
  for (let i = 0; i < (await rows.count()); i += 1) {
    const text = await rows.nth(i).innerText();
    expect(text.includes("成功") || text.includes("失败")).toBe(true);
  }
});

test("损耗报告:导入 → 分析 → 导出,发料为 0 时损耗率标「不可算」", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/scrap");

  // 数据主权要写明:本系统没有工单投料
  await expect(page.getByText(/本系统没有工单投料数据/).first()).toBeVisible();

  const stamp = Date.now();
  const period = `E2E-${stamp % 100000}`;
  await page.getByLabel(/损耗明细/).fill(
    [
      "期间,客户,工单,MPN,发料数量,报废数量,原因",
      `${period},LC,WO-1,E2E-SCRAP-A,1000,10,上料错误`,
      // 发料为 0 却有报废:损耗率必须是「不可算」,不能算成 0%
      `${period},LC,WO-2,E2E-SCRAP-B,0,5,来料不良`,
      // 原因未填:必须单列「未填」档
      `${period},LC,WO-3,E2E-SCRAP-C,500,20,`,
    ].join("\n"),
  );
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByTestId("scrap-import-msg")).toContainText("已导入 3 条");

  await page.goto(`/scrap?period=${period}&dim=mpn`);
  await expect(page.locator(".kpi", { hasText: "发料 0 却有报废" })).toContainText("1");
  const rowB = page.locator("tbody tr").filter({ hasText: "E2E-SCRAP-B" });
  await expect(rowB).toContainText("不可算");

  // 未填原因单列一档
  await page.goto(`/scrap?period=${period}&dim=reason`);
  await expect(page.getByText("未填").first()).toBeVisible();

  // 导出
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出损耗报告" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("scrap-report.xlsx");
});

test("损耗导入:缺必需列整表拒绝,缺发料只提示不阻断", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/scrap");

  await page.getByLabel(/损耗明细/).fill("期间,MPN\n2026-07,A");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByTestId("scrap-import-msg")).toContainText("缺少必需列");

  await page.getByLabel(/损耗明细/).fill("期间,MPN,发料数量,报废数量\n2026-07,E2E-NOISSUE,,7");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByTestId("scrap-import-msg")).toContainText("已导入 1 条");
  await expect(page.getByText(/该行损耗率将不可算/)).toBeVisible();
});
