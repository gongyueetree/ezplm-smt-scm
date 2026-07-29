import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * 人工指定型号 + 替代料查询 E2E。
 *
 * 背景:此前匹配确认页只有「采纳候选」与「标记无匹配」——
 * 一行没有候选时,人**没有任何地方可以填型号**,流程就卡死在那里。
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

test("匹配确认页可人工指定型号,并写回 BOM 行", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.ezplm.cn");

  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles(BOM_FIXTURE);
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: /进入匹配确认/ }).first().click();
  await page.waitForURL("**/bom/version/**");

  // 人工指定入口必须存在(不能只有"采纳候选/标记无匹配")
  const input = page.getByPlaceholder("人工指定型号").first();
  await expect(input).toBeVisible();

  await input.fill("MANUAL-TEST-MPN-001");
  await page.getByRole("button", { name: "确认指定" }).first().click();

  // 决定被记录,且**型号写回了 BOM 行**(否则后续比价读不到)
  await expect(page.getByText("已人工指定").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "MANUAL-TEST-MPN-001" }).first()).toBeVisible();
});

test("替代料查询:对任意型号可用,并说明管脚数不同不可换", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/materials/alternates");

  await expect(page.locator(".page-title")).toHaveText("替代料查询");
  // 措辞纪律:必须写明这是候选、须人工确认
  await expect(page.getByText(/必须由工程按参数、封装、合规逐项人工确认/)).toBeVisible();
  await expect(page.getByText(/管脚数不同一律判为不可换/)).toBeVisible();

  await page.getByLabel("待查型号").fill("MIC5504-3.3YM5-TR");
  await page.getByRole("button", { name: "查找替代料" }).click();

  // 要么给出候选,要么如实说没有 —— 不得静默无反应
  await expect
    .poll(
      async () =>
        (await page.locator("table.tbl tbody tr").count()) +
        (await page.getByText(/未找到够格的替代候选/).count()),
      { timeout: 90_000 },
    )
    .toBeGreaterThan(0);
});
