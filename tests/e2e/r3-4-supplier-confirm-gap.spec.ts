import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * R3-4:供应商确认补全 —— CALL_MATERIAL 与 RFQ_QUOTE 免登录闭环。
 *
 * 门禁矩阵:
 * ① Call 料 → 生成确认链接 → 匿名回复「可供 300 · 交期」→ 回填
 *    CallMaterialRecord.reply* → 处理台显示回复摘要;重放 409/已确认页;
 * ② 采购询价单 → 报价链接 → 匿名填 单价/MOQ/有效期 → 落 SupplierOffer+
 *    PriceBreak(OFFLINE 报价池,GET 可查);混入不在询价单里的 MPN 被
 *    丢弃并如实计数(droppedLines);
 * ③ 无供应商的 Call 料记录拒绝生成链接(400,不产死链)。
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

async function anonPage(browser: Browser) {
  const fakeIp = `10.98.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp } });
  return { ctx, page: await ctx.newPage() };
}

function tokenOf(url: string): string {
  return url.split("/confirm/")[1];
}

async function xlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("缺料单");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const HEAD = ["客户", "内部料号", "制造商", "MPN", "需求数量", "可用库存", "在途", "供应商", "ETA", "缺口数量", "需求日期"];

test("CALL_MATERIAL:Call 料 → 链接 → 匿名回复可供 → 回填 reply* → 处理台可见;重放被挡", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await login(page, "procurement@demo.qianchuang.cn");
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const mpn = `R34C-${u}`;

  // 供应商列填种子库供应商 code(SUP-A)——链接是供应商定向的,没有供应商拒发
  const buf = await xlsx([HEAD, ["", "", "ST", mpn, 1000, "", "", "SUP-A", "", 500, "2026-10-01"]]);
  await page.goto("/shortage");
  await page.getByLabel("选择文件").setInputFiles({
    name: `r34-${u}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByTestId("sheet-import-note")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "执行导入" }).click();
  await expect(page.getByTestId("sheet-import-note")).toContainText("已导入", { timeout: 30_000 });

  const row = () => page.getByTestId("shortage-sheet-lines").locator("tbody tr").filter({ hasText: mpn });
  page.on("dialog", (d) => void d.accept("500"));
  await row().getByRole("button", { name: "Call 料" }).click();
  await expect(row()).toContainText("已建 Call 料", { timeout: 30_000 });

  // 生成确认链接(仅显示一次)
  await row().getByRole("button", { name: "确认链接" }).click();
  const linkOut = row().locator('[data-testid^="call-link-out-"] code');
  await expect(linkOut).toBeVisible({ timeout: 15_000 });
  const rawToken = tokenOf((await linkOut.innerText()).trim());
  expect(rawToken, "链接里应有 token").toBeTruthy();

  const { ctx, page: pub } = await anonPage(browser);
  try {
    await pub.goto(`/confirm/${rawToken}`);
    await expect(pub.getByTestId("call-line")).toContainText(mpn);
    // 未表态不可提交
    await pub.getByLabel("您的姓名").fill("李四");
    await pub.getByLabel("您的邮箱").fill("li@sup.example");
    await expect(pub.getByTestId("confirm-submit")).toBeDisabled();

    await pub.getByRole("radio", { name: "可以供应" }).check();
    await pub.getByLabel("可供数量").fill("300");
    await pub.getByLabel("最早交期").fill("2026-10-15");
    await pub.getByTestId("confirm-submit").click();
    await expect(pub.getByTestId("confirm-done")).toBeVisible();

    // 重放:token 已 RESPONDED → 已确认页
    await pub.goto(`/confirm/${rawToken}`);
    await expect(pub.getByTestId("confirm-replayed")).toBeVisible();
  } finally {
    await ctx.close();
  }

  // 处理台显示回复摘要(reply* 已回填)
  await page.reload();
  await expect(row().locator('[data-testid^="call-reply-"]')).toContainText("可供 300", { timeout: 15_000 });
});

test("RFQ_QUOTE:询价单 → 报价链接 → 匿名报价 → 落 SupplierOffer;外来 MPN 被丢弃", async ({ page, browser }) => {
  test.setTimeout(300_000);
  // 建 BOM + 采购询价单(复用 procurement.spec 的夹具与流程)
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/bom/import");
  const raw = readFileSync(BOM_FIXTURE, "utf-8");
  const unique = `${raw.trimEnd()}·r34-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.getByLabel("选择文件(可多选)").setInputFiles({
    name: `r34-bom-${Date.now()}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(unique, "utf-8"),
  });
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });

  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/procurement/rfq");
  const options = page.locator("select[multiple] option");
  await expect(options.first()).toBeVisible();
  await page.locator("select[multiple]").selectOption({ index: 0 });
  await page.getByRole("button", { name: "创建采购 RFQ" }).click();
  await expect(page).toHaveURL(/\/procurement\/rfq\/[^/]+$/);

  // 生成报价链接(选种子供应商)
  await page.getByLabel("报价供应商").selectOption({ label: "华强北电子(示例)" });
  await page.getByTestId("gen-quote-link").click();
  const out = page.getByTestId("quote-link-out");
  await expect(out).toBeVisible({ timeout: 15_000 });
  const rawToken = tokenOf((await out.locator("code").innerText()).trim());

  const { ctx, page: pub } = await anonPage(browser);
  let quotedMpn = "";
  try {
    await pub.goto(`/confirm/${rawToken}`);
    const firstRow = pub.getByTestId("quote-lines").locator("tbody tr").first();
    await expect(firstRow).toBeVisible();
    quotedMpn = (await firstRow.locator("td").first().innerText()).trim();

    // UI 填第一行;再经 API 混入一个不在询价单里的 MPN,断言被丢弃
    await firstRow.locator("input").nth(0).fill("12.5"); // 单价
    await firstRow.locator("input").nth(1).fill("100"); // MOQ
    await firstRow.locator('input[type="date"]').fill("2026-12-31");
    await pub.getByLabel("您的姓名").fill("王五");
    await pub.getByLabel("您的邮箱").fill("w@sup.example");

    // 直接走 API 提交(带混入行),等价于表单提交且能断言计数
    const res = await pub.request.post(`/api/confirm/${rawToken}`, {
      data: {
        kind: "RFQ_QUOTE",
        respondedByName: "王五",
        respondedByEmail: "w@sup.example",
        currency: "CNY",
        lines: [
          { mpn: quotedMpn, unitPrice: "12.5", moq: "100", validUntil: "2026-12-31", note: "含税" },
          { mpn: `EVIL-${Date.now()}`, unitPrice: "0.01" }, // 不在询价单里 → 丢弃
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { savedLines: number; droppedLines: number };
    expect(body.savedLines).toBe(1);
    expect(body.droppedLines).toBe(1);

    // 重放 → 409
    const replay = await pub.request.post(`/api/confirm/${rawToken}`, {
      data: { kind: "RFQ_QUOTE", respondedByName: "王五", respondedByEmail: "w@sup.example", currency: "CNY", lines: [{ mpn: quotedMpn, unitPrice: "11" }] },
    });
    expect(replay.status()).toBe(409);
  } finally {
    await ctx.close();
  }

  // 报价池可查:MPN + 价格 + 有效期 + 备注落到 SupplierOffer/PriceBreak
  const offers = await page.request.get(`/api/procurement/supplier-offers?mpn=${encodeURIComponent(quotedMpn)}`);
  expect(offers.status()).toBe(200);
  const list = (await offers.json()) as {
    offers: { mpn: string; currency: string; moq: string | null; validUntil: string | null; supplierNote: string | null; priceBreaks: { minQty: string; unitPrice: string }[] }[];
  };
  const mine = list.offers.find((o) => o.supplierNote === "含税");
  expect(mine, "链接报价应落进报价池").toBeTruthy();
  expect(mine!.currency).toBe("CNY");
  expect(mine!.validUntil).toBe("2026-12-31");
  expect(mine!.priceBreaks[0]).toMatchObject({ unitPrice: "12.5" });
});

test("无供应商的 Call 料记录拒绝生成链接(不产死链)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "procurement@demo.qianchuang.cn");
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const mpn = `R34N-${u}`;
  const buf = await xlsx([HEAD, ["", "", "", mpn, 100, "", "", "", "", 100, ""]]);
  await page.goto("/shortage");
  await page.getByLabel("选择文件").setInputFiles({
    name: `r34n-${u}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByTestId("sheet-import-note")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "执行导入" }).click();
  await expect(page.getByTestId("sheet-import-note")).toContainText("已导入", { timeout: 30_000 });

  const row = () => page.getByTestId("shortage-sheet-lines").locator("tbody tr").filter({ hasText: mpn });
  page.on("dialog", (d) => void d.accept("100"));
  await row().getByRole("button", { name: "Call 料" }).click();
  await expect(row()).toContainText("已建 Call 料", { timeout: 30_000 });

  await row().getByRole("button", { name: "确认链接" }).click();
  // 无供应商 → 400,错误横幅出现,不产出链接
  await expect(page.getByRole("alert").filter({ hasText: "先指定供应商" })).toBeVisible({ timeout: 15_000 });
  await expect(row().locator('[data-testid^="call-link-out-"]')).toHaveCount(0);
});
