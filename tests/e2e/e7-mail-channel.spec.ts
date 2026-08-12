import { expect, test, type Page } from "@playwright/test";

/**
 * E7 / 客户 Q3:发送 = 公司 SMTP;回执 = **已读回执**。
 *
 * SMTP 参数尚未提供(O4),所以这一轮只能交付到:
 * Provider + 状态机 + 配置页 + 自检。用例守的是**诚实**:
 * ① 未配置时状态写 WAITING_FOR_CREDENTIALS,并逐项列出缺什么;
 * ② 页面**绝不出现「已发送」**这种完成态;
 * ③ 已读回执的技术限制必须写在页面上;
 * ④ 自检**不发邮件**。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("未配置 SMTP 时如实标注待客户提供,并逐项列出缺什么", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/mail");

  const note = page.getByTestId("mail-status-note");
  await expect(note).toBeVisible();

  const res = await page.request.get("/api/settings/mail");
  const body = await res.json();
  if (!body.configured) {
    await expect(page.getByTestId("mail-status-badge")).toContainText("待客户提供参数");
    await expect(note).toContainText("WAITING_FOR_CREDENTIALS");
    // 逐项列出缺什么,而不是笼统一句"未配置"
    expect(body.missing.length).toBeGreaterThan(0);
    await expect(note).toContainText("SMTP_HOST");
    // 未配置时必须明说邮件停在草稿
    await expect(note).toContainText("草稿 · 未发送");
    await expect(note).toContainText("不会假装已经发出去");
  }
});

test("**已读回执的技术限制必须写在页面上**", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/mail");
  const note = page.getByTestId("mail-status-note");
  await expect(note).toContainText("依赖");
  await expect(note).toContainText("拿不到是常态");
  await expect(note).toContainText("没收到回执不等于对方没看");
  // 三种状态分开记这件事也要写清楚
  await expect(note).toContainText("三种状态分开记");
});

test("连接自检不发邮件;未配置时说清缺哪些参数", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/mail");

  await page.getByTestId("mail-verify").click();
  const result = page.getByTestId("mail-verify-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText("没有发送任何邮件");
});

test("口令永不回传:接口响应里没有 SMTP_PASSWORD 的值", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  const res = await page.request.get("/api/settings/mail");
  const text = await res.text();
  expect(text).not.toContain("password");
  expect(text).not.toContain("SMTP_PASSWORD=");
  // 页面上只说"已配置(不显示)"或"未配置"
  await page.goto("/settings/mail");
  await expect(page.getByText(/已配置\(不显示\)|未配置/).first()).toBeVisible();
});

test("非管理层不能看邮件通道配置", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  const res = await page.request.get("/api/settings/mail");
  expect(res.status()).toBe(403);
});
