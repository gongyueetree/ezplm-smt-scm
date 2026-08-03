import { expect, test, type Page } from "@playwright/test";

/**
 * 批次6 E2E:供应商协同三项(客户 docx)。
 *
 * 最要紧的一条纪律:**邮件通道未接入,系统不发送任何邮件**。
 * 全页不得出现「已发送」,草稿状态只有「草稿(未发送)」/「已预览(未发送)」。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("协同页:明确声明邮件未接入,且不存在「已发送」状态", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/suppliers/collab");

  await expect(page.locator(".page-title")).toHaveText("供应商协同");
  await expect(page.getByText(/邮件通道未接入/).first()).toBeVisible();
  await expect(page.getByText(/没有「已发送」这个状态/)).toBeVisible();
  // 任何徽标都不得写「已发送」
  expect(await page.locator(".badge", { hasText: "已发送" }).count()).toBe(0);
});

test("供应商建档邀请:生成链接与草稿,措辞不含已发送;资料复核前不进主数据", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/suppliers/collab");

  const name = `E2E供应商-${Date.now()}`;
  await page.getByLabel("公司名称").fill(name);
  await page.getByRole("button", { name: "生成邀请" }).click();
  await expect(page.getByTestId("invite-msg")).toContainText("系统未发送");

  // 按卡片收窄:公司名同时出现在「邮件草稿」与「建档邀请」两张表里
  const inviteCard = page.locator(".card", { hasText: "供应商建档邀请" }).last();
  const row = inviteCard.locator("tbody tr").filter({ hasText: name });
  await expect(row).toContainText("待供应商回填");
  await expect(page.getByText(/不进入正式主数据/).first()).toBeVisible();

  // 草稿状态必须带「未发送」
  const draftCard = page.locator(".card", { hasText: "邮件草稿" });
  await expect(draftCard.locator("tbody tr").first()).toContainText("未发送");
});

test("批量生成订单邮件草稿:未审批订单不出现在候选里", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/suppliers/collab");

  const card = page.locator(".card", { hasText: "批量生成订单邮件草稿" });
  await expect(card).toBeVisible();
  await expect(card.getByText(/仅限已审批订单/)).toBeVisible();

  const boxes = card.locator('input[type="checkbox"]');
  const n = await boxes.count();
  if (n === 0) {
    // 没有已审批订单时,如实显示空态而不是给一个假清单
    await expect(card.getByText("暂无已审批订单")).toBeVisible();
    return;
  }
  await boxes.first().check();
  await page.getByRole("button", { name: /生成 \d+ 封草稿/ }).click();
  await expect(page.getByTestId("dispatch-msg")).toContainText("系统未发送");
});

test("接单回执:人工登记并如实记录来源渠道", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/suppliers/collab");

  const card = page.locator(".card", { hasText: "登记接单回执" });
  await expect(card.getByText(/只能人工登记/)).toBeVisible();

  const options = await page.getByTestId("ack-po").locator("option").count();
  test.skip(options === 0, "库里没有已审批订单可登记回执");

  await page.getByTestId("ack-decision").selectOption("PARTIAL");
  await page.getByRole("button", { name: "登记", exact: true }).click();
  await expect(page.getByTestId("ack-msg")).toContainText("已登记回执");

  const row = page.locator("tbody tr").filter({ hasText: "部分接受" }).first();
  await expect(row).toContainText("邮件(人工登记)");
});
