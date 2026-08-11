import { expect, test, type Page } from "@playwright/test";

/**
 * N-11(客户 PR2 反馈 采购-12 库存总览)。
 * 客户四条:①需要 PN ②带入所有 MFG&MPN ③客户筛选 + 日期 ④显示需求。
 * ③本来就有;①②已补;④**刻意不做** —— 需求口径未定义,见页面说明与 PR 描述。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("N-11 库存明细带 PN 与制造商,并给出口径明确的在途", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/inventory");

  const head = page.locator(".card", { hasText: "物料库存明细" }).locator("table.tbl thead");
  await expect(head).toContainText("PN");
  await expect(head).toContainText("MPN");
  await expect(head).toContainText("制造商");
  await expect(head).toContainText("在途");
  // 原有列不能丢
  await expect(head).toContainText("在库");
  await expect(head).toContainText("呆滞");
});

test("N-11 「需求」未定义时如实说明,**不给假数字**", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/inventory");

  const card = page.locator(".card", { hasText: "物料库存明细" });
  await expect(card).toContainText("需先定义口径");
  // 不得出现一个叫「需求」的数据列 —— 那会被当成可直接下单的依据
  await expect(card.locator("table.tbl thead")).not.toContainText("需求");
});

test("N-11 客户与日期筛选可用(既有能力,防回归)", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/inventory");
  await expect(page.getByLabel(/客户/)).toBeVisible();
  await expect(page.getByLabel(/日期|截至/)).toBeVisible();
});
