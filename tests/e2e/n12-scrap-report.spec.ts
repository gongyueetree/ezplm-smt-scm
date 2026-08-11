import { expect, test, type Page } from "@playwright/test";

/**
 * N-12(客户 PR2 反馈 采购-13 损耗报告):
 *   ①多维度 + **多月比较** ②数量与**金额**分别分析 ③带入 **STD 价格** ④导入/导出模板(已有)
 *
 * 核心纪律:**缺标准价不当 0** —— 损耗最重的料往往正是没人维护主数据的那些,
 * 按 0 算会把问题掩盖掉。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("N-12 损耗分析有金额列;缺标准价显示「未维护」而不是 0", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "procurement@demo.qianchuang.cn");
  const u = Date.now().toString(36).toUpperCase();
  const mpn = `N12-NOCOST-${u}`;

  // 导入一条损耗:该 MPN 在主数据里不存在,因此没有标准价
  await page.goto("/scrap");
  await page.getByLabel(/损耗明细/).fill(
    `期间,客户,工单,MPN,发料数量,报废数量,原因\n2026-07,LC,WO-${u},${mpn},1000,10,E2E`,
  );
  await page.getByRole("button", { name: "导入", exact: true }).click();
  /*
   * 必须等**真正的成功回执**「已导入 N 条」。
   * 原来写的 getByText(/导入/) 会命中按钮本身,断言立刻通过 ——
   * 于是还没写库就跳去了报表页,表里当然没有这行(实测踩到)。
   */
  await expect(page.getByText(/已导入 \d+ 条/)).toBeVisible({ timeout: 30_000 });

  await page.goto("/scrap?dim=mpn&mpn=" + encodeURIComponent(mpn));
  const table = page.locator(".card", { hasText: "损耗分析" }).locator("table.tbl");
  await expect(table.locator("thead")).toContainText("损耗金额");

  const row = table.locator("tbody tr").filter({ hasText: mpn });
  await expect(row).toHaveCount(1);
  // 关键:缺价显示「未维护」,**绝不能是 0**
  await expect(row).toContainText("未维护");
  await expect(row.locator("td").nth(4)).not.toHaveText("0");
  // 数量口径不受影响
  await expect(row).toContainText("10");
});

test("N-12 多月比较表存在,期间列固定生成且空期照样占位", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/scrap");

  const trend = page.getByTestId("scrap-trend");
  await expect(trend).toBeVisible();

  // 固定 6 期 + 维度列 + 环比列
  const headers = trend.locator("thead th");
  await expect(headers).toHaveCount(8);
  await expect(headers.last()).toContainText("环比");

  // 说明必须点明"空期是没有数据,不等于零损耗"
  const card = page.locator(".card", { hasText: "多月比较" });
  await expect(card).toContainText("没有数据");
  await expect(card).toContainText("不拿 0 当基准");
});

test("N-12 页面必须说清缺标准价怎么补,而不是只显示「未维护」", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/scrap");

  const card = page.locator(".card", { hasText: "损耗分析" });
  // 只有当确实存在缺价组时才提示;有则必须给出补录路径
  if (await card.getByText(/未维护/).first().isVisible().catch(() => false)) {
    await expect(card).toContainText("标准价(STD)");
    await expect(card).toContainText("不按 0 计入");
  }
});
