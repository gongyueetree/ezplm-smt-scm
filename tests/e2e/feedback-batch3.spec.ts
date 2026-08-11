import { expect, test, type Page } from "@playwright/test";

/**
 * 客户 PR2 反馈第三批(S-4 / S-5 / S-6 / S-7)。
 * 分诊与逐条依据见 docs/customer-feedback/PR2-FEEDBACK-TRIAGE.md。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("S-6 未回复表必须显示供应商与需求日期 —— 卡片叫「未回复供应商」却看不出催谁", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/suppliers/opo");

  const card = page.locator(".card", { hasText: "未回复供应商" });
  const head = card.locator("table.tbl thead");
  await expect(head).toContainText("供应商");
  await expect(head).toContainText("需求日期");
  // 原有列不能丢
  await expect(head).toContainText("ERP 承诺");
  await expect(head).toContainText("未交量");
});

test("S-5 缺料分析按客户点名的四条调整:有 PN/库存/在途/交期,且**不再有建议采购**", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/shortage");

  const select = page.getByLabel(/BOM 版本|版本/).first();
  const values = await select.locator("option").evaluateAll((els) =>
    els.map((e) => (e as HTMLOptionElement).value).filter(Boolean),
  );
  test.skip(values.length === 0, "库里没有 BOM 版本");

  await page.goto(`/shortage?v=${values[0]}&boards=100`);
  const head = page.locator(".card", { hasText: "Call 料表" }).locator("table.tbl thead");
  await expect(head).toContainText("PN");
  await expect(head).toContainText("库存");
  await expect(head).toContainText("在途");
  await expect(head).toContainText("交期");
  // 客户明确说「不需要建议采购」
  await expect(head).not.toContainText("建议采购");
});

test("S-7 Pin-to-Pin 与封装兼容必须说清区别,而不是看起来重复", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/materials/alternates");

  // 页面上要明说二者不是一回事(客户原话:「是否和封装重复了?」)
  await expect(page.getByText(/不是同一件事/)).toBeVisible();

  // 两个模式都还在 —— 澄清的结论是不合并(同封装不同引脚定义会烧板)
  await expect(page.getByRole("button", { name: /Pin-to-Pin/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /封装兼容/ })).toBeVisible();

  // 选中封装兼容时,模式说明必须点出"只保证贴得上去、引脚不保证"。
  // 用模式说明区定位:页面顶部的纪律说明里也含同样措辞,裸 getByText 会撞两个元素。
  await page.getByRole("button", { name: /封装兼容/ }).click();
  await expect(page.getByTestId("mode-desc")).toContainText("贴得上去");
  await expect(page.getByTestId("mode-desc")).toContainText("引脚功能是否一致不保证");
});
