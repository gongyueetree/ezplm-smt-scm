import { expect, test, type Page } from "@playwright/test";

/**
 * AR/AP 对账 E2E。
 *
 * 对应客户 xlsx「应收应付自动对账」,其中两条原标注为「无」:
 * - 对账差异自动识别、高亮标注与预警;
 * - 应收应付全生命周期管理、账龄分析与报表生成。
 *
 * 同时锁住本项目的纪律:
 * - AR/AP 按角色与 Tab 区分(SPEC §16);
 * - 异币种不做换算;
 * - **金额对得上但数量/单价对不上,绝不判一致**;
 * - 到期日未知单列,不并入 0–30;
 * - 诚实 UI:邮件通道未接入,任何地方不得出现"已发送"。
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/** 建单并返回详情页 id;每条用例自建,避免互相干扰 */
async function createStatement(page: Page, code: string): Promise<string> {
  await page.goto("/reconciliation");
  await page.getByRole("button", { name: "新建对账单" }).click();
  await page.getByLabel("对账单号").fill(code);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.waitForURL(/\/reconciliation\/[^/]+$/);
  return page.url().split("/").pop()!;
}

test("台账页不再是占位页,且如实声明本系统不拥有出入库数据", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/reconciliation");

  await expect(page.locator(".page-title")).toHaveText("AR/AP 对账");
  await expect(page.getByText("状态:待实现")).toHaveCount(0);

  // 数据主权必须写明,不能让人以为系统对上了 ERP 流水
  await expect(page.getByText(/本系统不拥有出货、入库、发票记录/)).toBeVisible();
  await expect(page.getByText(/邮件通道未接入,系统不发送任何邮件/)).toBeVisible();
  // 全页不得出现"已发送"
  expect(await page.getByText("已发送").count()).toBe(0);
});

test("AR/AP 按角色区分:采购只见应付,PM 只见应收", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/reconciliation");
  await expect(page.getByText(/当前角色可见:.*应付/)).toBeVisible();
  // 采购直接点 AR 也不该被放进去
  await page.goto("/reconciliation?kind=AR");
  await expect(page.getByText(/当前角色可见:.*应付/)).toBeVisible();

  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/reconciliation");
  await expect(page.getByText(/当前角色可见:.*应收/)).toBeVisible();

  /*
   * 管理层两侧都能看,且有 Tab 可切。
   * 定位收窄到 Tab 区:E5 之后页面上还有「下载应收/应付对账单样例」按钮,
   * 同样含「应收」「应付」字样,裸 getByRole 会撞上它们。
   */
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/reconciliation");
  const tabs = page.getByTestId("recon-kind-tabs");
  await expect(tabs.getByRole("link", { name: /应收/ })).toBeVisible();
  await expect(tabs.getByRole("link", { name: /应付/ })).toBeVisible();
});

test("差异识别:金额差异 / 仅一方有 / 异币种,逐类判定并高亮", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  const stamp = Date.now();
  await createStatement(page, `E2E-REC-${stamp}`);

  // 我方基准用「ERP 导出明细上传」,这样两侧数据都由用例掌控,结果可复现
  await page.getByRole("button", { name: "上传 ERP 导出明细" }).click();

  await page.getByLabel(/对方对账单/).fill(
    [
      "发票号,行号,MPN,数量,单价,金额,到期日",
      "INV-1,1,A-SAME,100,7.00,700.00,2026-08-30", // 一致
      "INV-2,1,A-DIFF,100,7.00,750.00,2026-07-01", // 金额差异
      "INV-3,1,A-ONLYTHEIRS,10,1.00,10.00,2026-07-01", // 仅对方有
      "INV-4,1,A-USD,10,1.00,10.00,2026-07-01", // 异币种
    ].join("\n"),
  );
  await page.getByLabel(/我方明细/).fill(
    [
      "发票号,行号,MPN,数量,单价,金额,币种",
      "INV-1,1,A-SAME,100,7.00,700.00,CNY",
      "INV-2,1,A-DIFF,100,7.00,700.00,CNY",
      "INV-4,1,A-USD,10,1.00,10.00,USD",
      "INV-9,1,A-ONLYOURS,5,2.00,10.00,CNY",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "执行匹配" }).click();

  const summary = page.getByTestId("recon-summary");
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary).toContainText("一致 1");
  await expect(summary).toContainText("差异 1");
  await expect(summary).toContainText("仅对方有 1");
  await expect(summary).toContainText("仅我方有 1");
  // 异币种要标注且被排除出合计
  await expect(summary).toContainText("含异币种");

  // 明细表逐类判定
  for (const verdict of ["一致", "金额差异", "仅对方有", "仅我方有", "币种不一致"]) {
    await expect(page.getByText(verdict, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText(/不做汇率换算/).first()).toBeVisible();
});

test("**金额对得上但数量与单价互相抵消,绝不判一致**", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await createStatement(page, `E2E-RECX-${Date.now()}`);
  await page.getByRole("button", { name: "上传 ERP 导出明细" }).click();

  // 对方 200×3.50=700,我方 100×7.00=700 —— 金额相同,明细不同
  await page.getByLabel(/对方对账单/).fill("发票号,行号,MPN,数量,单价,金额\nINV-1,1,TRAP,200,3.50,700.00");
  await page.getByLabel(/我方明细/).fill("发票号,行号,MPN,数量,单价,金额\nINV-1,1,TRAP,100,7.00,700.00");
  await page.getByRole("button", { name: "执行匹配" }).click();

  const summary = page.getByTestId("recon-summary");
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary).toContainText("一致 0");
  await expect(page.getByText("数量差异", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/金额合得上但明细对不上/)).toBeVisible();
});

test("账龄分析:到期日未知单列,不并入 0–30", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await createStatement(page, `E2E-RECA-${Date.now()}`);
  await page.getByRole("button", { name: "上传 ERP 导出明细" }).click();

  // 一行有到期日(远期,未到期)、一行没有到期日
  await page.getByLabel(/对方对账单/).fill(
    [
      "发票号,行号,MPN,金额,到期日",
      "INV-1,1,A,1000,2099-01-01",
      "INV-2,1,B,2000,",
    ].join("\n"),
  );
  await page.getByLabel(/我方明细/).fill(
    ["发票号,行号,MPN,金额", "INV-1,1,A,1000", "INV-2,1,B,2000"].join("\n"),
  );
  await page.getByRole("button", { name: "执行匹配" }).click();
  await expect(page.getByTestId("recon-summary")).toBeVisible({ timeout: 30_000 });

  const aging = page.locator(".card", { hasText: "账龄分析" });
  await expect(aging).toBeVisible();
  await expect(aging.getByText(/账龄不可知 —— 未并入 0–30 天/)).toBeVisible();

  // 未到期 1000、未知 2000、0-30 必须是 0
  const row = (name: string) => aging.locator("tbody tr").filter({ hasText: name }).first();
  await expect(row("未到期")).toContainText("1000");
  await expect(row("到期日未知")).toContainText("2000");
  await expect(row("0-30")).toContainText("0");
  // 逾期合计不含未到期与未知
  await expect(aging.locator("tbody tr").filter({ hasText: "逾期合计" })).toContainText("0");
});

test("解析报错逐行给出;导出附件的措辞不是「发送」", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await createStatement(page, `E2E-RECE-${Date.now()}`);

  // 既无金额也无数量单价 → 整表拒绝
  await page.getByLabel(/对方对账单/).fill("发票号,MPN\nINV-1,A");
  await page.getByRole("button", { name: "执行匹配" }).click();
  await expect(page.getByTestId("recon-error")).toContainText("至少要有其中一种");

  // 正常匹配后才出现导出入口,且措辞必须是「导出…附件」而非「发送」
  await page.getByRole("button", { name: "上传 ERP 导出明细" }).click();
  await page.getByLabel(/对方对账单/).fill("发票号,行号,MPN,金额\nINV-1,1,A,700");
  await page.getByLabel(/我方明细/).fill("发票号,行号,MPN,金额\nINV-1,1,A,700");
  await page.getByRole("button", { name: "执行匹配" }).click();
  await expect(page.getByTestId("recon-summary")).toBeVisible({ timeout: 30_000 });

  const exportLink = page.getByRole("link", { name: /导出对账单附件/ });
  await expect(exportLink).toBeVisible();
  expect(await page.getByRole("button", { name: /发送对账单/ }).count()).toBe(0);

  const download = page.waitForEvent("download");
  await exportLink.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^recon-AP-E2E-RECE-.*\.xlsx$/);
});
