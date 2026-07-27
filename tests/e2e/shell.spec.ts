import { expect, test } from "@playwright/test";

/**
 * PR1 UI Shell 冒烟用例:
 * 菜单由统一 route config 生成、子页面有返回上一层按钮。
 * 业务流程 E2E(SPEC §17 清单)随对应功能 PR 增补。
 */

test("首页渲染侧边栏,菜单来自统一 route config", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sidebar .brand-name")).toHaveText("硬禾科技 ezPLM");
  // SPEC §2 的 15 条路由都应出现在菜单中
  const hrefs = await page.locator(".sidebar .nav a.nav-item").evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")),
  );
  for (const p of [
    "/",
    "/rfq",
    "/bom",
    "/bom/import",
    "/bom/compare",
    "/materials",
    "/quotes",
    "/procurement/rfq",
    "/procurement/orders",
    "/suppliers/opo",
    "/reconciliation",
    "/shortage",
    "/kitting",
    "/inventory",
    "/settings",
  ]) {
    expect(hrefs, `菜单缺少 ${p}`).toContain(p);
  }
});

test("子页面有返回上一层按钮并可返回", async ({ page }) => {
  await page.goto("/bom/import");
  const back = page.locator(".back-link");
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/bom$/);
});

test("占位页如实标注待实现状态(诚实 UI)", async ({ page }) => {
  await page.goto("/quotes");
  await expect(page.locator(".banner")).toContainText("待实现");
  await expect(page.locator(".banner")).toContainText("PR7");
});
