import { expect, test, type Page } from "@playwright/test";

/**
 * 合规到期看板 E2E(客户 docx:「ROHS, REACH ,COC 的管控未列」)。
 *
 * 覆盖两条容易做错的口径:
 * - **「未标注有效期」按告警处理**,不按正常 —— 状态不可知不等于合规;
 * - **「缺少该类文档」与「文档已过期」是两件事**,分开统计。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("看板可达,且口径说明到位", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/materials/compliance");

  await expect(page.locator(".page-title")).toHaveText("合规到期看板");
  await expect(page.getByText(/「未标注有效期」按告警处理,不按正常/)).toBeVisible();
  await expect(page.getByText(/「缺少该类文档」与「文档已过期」是两件事/)).toBeVisible();

  // 两块必须都在:缺文档统计 与 文档清单
  await expect(page.getByText("缺少合规文档的物料")).toBeVisible();
  await expect(page.getByText("合规文档清单")).toBeVisible();
});

test("KPI 可下钻筛选到对应档位", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/materials/compliance");

  await page.locator(".kpi", { hasText: "未标注有效期" }).click();
  await expect(page).toHaveURL(/bucket=/);
  await expect(page.getByText(/已筛选:未标注有效期/)).toBeVisible();
  await expect(page.getByRole("link", { name: "清除筛选" })).toBeVisible();
});

test("**缺文档统计与过期统计是两张表**,不混为一谈", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/materials/compliance");

  // 缺文档表按类型列出物料数
  const missing = page.locator(".card", { hasText: "缺少合规文档的物料" });
  await expect(missing.getByText("RoHS 报告")).toBeVisible();
  await expect(missing.getByText("REACH 报告")).toBeVisible();
  await expect(missing.getByText("COC")).toBeVisible();

  // 文档清单表是另一张,列的是文档而不是物料数
  const list = page.locator(".card", { hasText: "合规文档清单" });
  await expect(list.getByRole("columnheader", { name: "有效期至" })).toBeVisible();
  await expect(list.getByRole("columnheader", { name: "状态" })).toBeVisible();
});
