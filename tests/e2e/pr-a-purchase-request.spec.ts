import { expect, test, type Page } from "@playwright/test";

/**
 * PR-A / PR2-PROC-05:采购申请单归 PM + 建议采购量公式拆解 + Excess 诚实空态。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("PR2-PROC-05-A 采购申请由 PM 发起 —— 采购能试算但不能自己建", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");

  /*
   * 试算是只读的,采购必须能算 —— 他接手询价时要能复核这个数怎么来的。
   * 闸门只拦落库建单。(第一版闸门放在 previewOnly 之前,把试算也挡了。)
   */
  const preview = await page.request.post("/api/procurement/requests", {
    data: { mpn: "STM32F103C8T6", demandQty: 1000, previewOnly: true },
  });
  expect(preview.status(), "采购必须能试算").toBe(200);

  const res = await page.request.post("/api/procurement/requests", {
    data: { mpn: "STM32F103C8T6", demandQty: 1000 },
  });
  expect(res.status()).toBe(403);
  const body = await res.text();
  // 必须说清为什么,而不是干巴巴一句无权限
  expect(body).toContain("PM");
  expect(body).toContain("需求量");
});

test("PR2-PROC-05-A PM 可以建,且试算不写库", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.qianchuang.cn");

  const preview = await page.request.post("/api/procurement/requests", {
    data: { mpn: "STM32F103C8T6", demandQty: 1000, previewOnly: true },
  });
  expect(preview.status()).toBe(200);
  const pv = await preview.json();
  expect(pv.preview.gtb.purchaseQty).toBeGreaterThanOrEqual(0);

  const created = await page.request.post("/api/procurement/requests", {
    data: { mpn: "STM32F103C8T6", demandQty: 1000, internalPn: `EE-PRA-${Date.now()}` },
  });
  expect(created.status(), await created.text()).toBe(201);
});

test("PR2-PROC-05-C 页面主标签是「建议采购量」,GTB 作技术名保留", async ({ page }) => {
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/procurement/request");

  await expect(page.getByText("建议采购量").first()).toBeVisible();
  // 与客户原话的对应关系不能丢
  await expect(page.getByText(/Gross To Buy/).first()).toBeVisible();
  // 公式各项都要出现在说明里
  const banner = page.locator(".banner.warn").first();
  await expect(banner).toContainText("需求量");
  await expect(banner).toContainText("损耗");
  await expect(banner).toContainText("可用库存");
  await expect(banner).toContainText("Excess");
  await expect(banner).toContainText("在途");
  await expect(banner).toContainText("MOQ");
});

test("PR2-PROC-05-C 试算后必须给出逐项公式拆解", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/procurement/request");

  await page.getByLabel(/MPN/).first().fill("STM32F103C8T6");
  await page.getByLabel(/需求数量|需求量/).first().fill("1000");
  await page.getByRole("button", { name: /试算建议采购量/ }).click();

  const bd = page.getByTestId("gtb-breakdown");
  await expect(bd).toBeVisible({ timeout: 30_000 });
  for (const label of ["需求量", "损耗", "可用库存", "可用 Excess", "在途", "MOQ / SPQ 圆整", "建议采购量"]) {
    await expect(bd).toContainText(label);
  }
});

test("PR2-PROC-05-D Excess 未接入时明说,**不造数也不显示 0**", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/procurement/request");

  await page.getByLabel(/MPN/).first().fill("STM32F103C8T6");
  await page.getByLabel(/需求数量|需求量/).first().fill("1000");
  await page.getByRole("button", { name: /试算建议采购量/ }).click();

  const status = page.getByTestId("excess-status");
  await expect(status).toBeVisible({ timeout: 30_000 });
  // 演示库没有 ExcessSnapshot,必须走未配置分支
  await expect(status).toContainText("未配置");
  await expect(status).toContainText("不按 0 计");

  // 公式里 Excess 那一行是「—」,不是 0
  const bd = page.getByTestId("gtb-breakdown");
  const row = bd.locator("tbody tr").filter({ hasText: "可用 Excess" });
  await expect(row).toContainText("—");
});

test("PR2-PROC-05 申请单列出客户点名的字段", async ({ page }) => {
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/procurement/request");
  const head = page.locator(".card", { hasText: "申请记录" }).locator("table.tbl thead");
  for (const col of ["内部料号", "制造商", "MPN", "客户 / 项目", "需求量", "需求日期", "库存", "Excess", "在途", "建议采购量", "选定采购量", "核准单价"]) {
    await expect(head).toContainText(col);
  }
});
