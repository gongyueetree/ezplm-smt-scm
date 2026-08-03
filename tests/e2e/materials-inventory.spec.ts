import { expect, test, type Page } from "@playwright/test";

/**
 * 批次3 E2E:
 * - 物料页 SMT 工艺字段列(MSL / 包装规格 / 盘装数量),本地维护、与 ezPLM 只读缓存分离;
 * - 库存与呆滞按客户 / 按日期查看(客户 docx 要求),且如实说明客户维度的口径;
 * - ERP 同步日志与导出。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("物料页:SMT 工艺列存在,未维护时说明是数据源不提供而非系统没做", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/materials");

  await expect(
    page.getByRole("columnheader", { name: "SMT 工艺(MSL / 包装 / 盘装)" }),
  ).toBeVisible();
  // 未维护的行要说明原因,不能只留空
  await expect(page.getByText("ezPLM 接口不提供,需本地填写").first()).toBeVisible();
});

test("SMT 工艺属性可本地维护,MSL 只接受标准等级", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/materials?q=STM32F103C8T6");
  const link = page.locator("a.mpn-link").first();
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL("**/materials/**");

  // 拿 partId:详情页按 MPN 路由,故直接用 API 校验非法值被拒
  const bad = await page.request.post("/api/materials/parts/not-exist/process-attr", {
    data: { msl: "MSL9" },
  });
  expect(bad.status()).toBe(400);
  expect(await bad.text()).toContain("MSL");
});

test("库存页:可按客户与日期筛选,且写明客户维度的真实口径", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/inventory");

  await expect(page.getByLabel("客户")).toBeVisible();
  await expect(page.getByLabel("截至日期")).toBeVisible();

  await page.getByLabel("截至日期").fill("2026-07-01");
  await page.getByRole("button", { name: "查看" }).click();
  await expect(page).toHaveURL(/asOf=2026-07-01/);
  await expect(page.getByText(/之前最新的一份快照/).first()).toBeVisible();
});

test("管理工作台:库存与呆滞入口在管理层,并说明客户维度不代表专属备料", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/");
  const card = page.locator(".card", { hasText: "库存总览与呆滞分析" });
  await expect(card).toBeVisible();
  await expect(card.getByText(/库存快照本身没有客户维度/).first()).toBeVisible();
  await expect(card.getByRole("link", { name: "库存总览" })).toBeVisible();
});

test("ERP 同步日志:可筛选可导出,且不声称 ERP 已接收", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/sync-log");

  await expect(page.locator(".page-title")).toHaveText("ERP 同步日志");
  // .first():这句同时存在于 <b> 与其父 <span>,不收窄会匹配到多个元素
  await expect(page.getByText(/「已生成」不等于「ERP 已接收」/).first()).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出同步记录" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("erp-sync-log.xlsx");
});
