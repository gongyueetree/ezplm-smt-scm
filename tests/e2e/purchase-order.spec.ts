import { expect, test, type Page } from "@playwright/test";

/**
 * 采购订单管理 E2E(客户 xlsx 三条「有,但无法深入操作,不知如何实现」的正面回应):
 * 1. PO 全流程创建、审批、跟踪;
 * 2. 批量录入、历史价对比与异常预警;
 * 3. 价格复核、修正与多级审批流。
 *
 * 另覆盖本项目的硬纪律:
 * - 冻结守卫(审批中不得改行);
 * - 已批准不可回到可编辑态;
 * - 退回必须记原因;
 * - **诚实 UI**:没有「已下单」,只有「已审批·待 ERP 录入」/「已导出 ERP 模板」。
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/** 每条用例自建单据并锁定 id —— 靠"库里正好有一张"会让用例互相干扰 */
async function createPo(
  page: Page,
  poNo: string,
  lines: string,
): Promise<string> {
  await page.goto("/procurement/orders");
  await page.getByRole("button", { name: "新建采购订单" }).click();
  await page.getByLabel("PO 号").fill(poNo);
  await page.getByLabel(/粘贴订单行/).fill(lines);
  await page.getByRole("button", { name: "创建订单" }).click();
  await page.waitForURL(/\/procurement\/orders\/[^/]+$/);
  const id = page.url().split("/").pop()!;
  expect(id, "创建后应跳转到详情页并拿到 id").toBeTruthy();
  return id;
}

/**
 * 固定样例必须在**任何**采购阈值配置下都不触发阈值类异常 ——
 * 阈值行(ProcurementPolicy)可能由别的用例写入(实测:maxUnitPrice 12 / maxLeadTimeDays 25),
 * 也可能在干净库里根本不存在。取 单价 7.10、交期 20 天,两种情况下都在线内,
 * 于是本用例只受"历史价"这一维影响。
 *
 * **MPN 必须每轮唯一**:历史价取的是本租户已批准单据的成交价,
 * 上一轮跑过的同 MPN 会让"首次采购"变成"持平",用例就不可复现了
 * (这个坑真实踩到过 —— 前一轮失败前已经批准了一张同 MPN 的单)。
 */
function okLines(mpn: string): string {
  return [
    "MPN\t数量\t单价\tMOQ\tSPQ\t交期\t需求日期",
    `${mpn}\t1000\t7.10\t100\t100\t20\t2026-12-01`,
  ].join("\n");
}

test("台账页不再是占位页,KPI 与筛选可用,且措辞不含虚假完成态", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/procurement/orders");

  await expect(page.locator(".page-title")).toHaveText("采购订单");
  // 占位页的标志性文案必须消失
  await expect(page.getByText("状态:待实现")).toHaveCount(0);

  // 诚实 UI:必须写明 ERP 才是下单执行真源
  await expect(page.getByText(/ERP 才是下单执行的真源/)).toBeVisible();
  await expect(page.getByText(/导出不代表 ERP 已接单/).first()).toBeVisible();
  // 不得有任何**状态徽标**写成"已下单"。
  // 注意别用整页文本查 —— 页面的诚实说明里本身就含"没有「已下单」状态"这句话,
  // 纯文本存在性检查分不清"声称已下单"和"说明没有已下单"。
  expect(await page.locator(".badge", { hasText: "已下单" }).count()).toBe(0);

  await expect(page.locator(".kpi", { hasText: "待 ERP 录入" })).toBeVisible();
  await expect(page.locator(".kpi", { hasText: "未处理异常行" })).toBeVisible();

  // 组合筛选可用
  await page.getByLabel("状态").selectOption("DRAFT");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page).toHaveURL(/status=DRAFT/);
});

test("批量录入:坏行逐行报错带行号,好行照常入库", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/procurement/orders");
  await page.getByRole("button", { name: "新建采购订单" }).click();

  await page.getByLabel(/粘贴订单行/).fill(
    "MPN,数量,单价\nE2E-GOOD,100,1.00\nE2E-BAD,abc,1.00\n,50,1.00",
  );
  await expect(page.getByText(/解析报错 2 条/)).toBeVisible();
  await expect(page.getByText(/第 3 行/)).toBeVisible();
  await expect(page.getByText(/第 4 行:缺少 MPN/)).toBeVisible();
  // 有报错时不允许提交
  await expect(page.getByRole("button", { name: "创建订单" })).toBeDisabled();

  // 缺列必须留空并说明,不能填 0
  await page.getByLabel(/粘贴订单行/).fill("MPN,数量\nE2E-NOPRICE,100");
  await expect(page.getByText(/不做默认值填充/).first()).toBeVisible();
});

test("全流程:提交复核 → 复核通过 → 终审通过 → 生成在途行 → 导出 ERP 模板", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.ezplm.cn"); // 管理层可走完全部环节
  const stamp = Date.now();
  const id = await createPo(page, `E2E-PO-${stamp}`, okLines(`E2E-PART-${stamp}`));

  // 首次采购:必须如实说"无历史价可比",不得显示成价格正常
  await expect(page.getByText(/首次采购/).first()).toBeVisible();
  await expect(page.getByText(/非「价格正常」/).first()).toBeVisible();

  // 建议下单日 = 需求日 − 交期 = 2026-12-01 − 20 天
  await expect(page.getByText("建议下单 2026-11-11")).toBeVisible();

  await page.getByRole("button", { name: "提交价格复核" }).click();
  await expect(page.getByText("待价格复核").first()).toBeVisible();
  // 冻结:进入复核后行项不可再改
  await expect(page.getByText("行项已冻结")).toBeVisible();

  await page.getByRole("button", { name: /复核通过/ }).click();
  await expect(page.getByText("待审批").first()).toBeVisible();

  await page.getByRole("button", { name: /终审通过并生成在途行/ }).click();
  await expect(page.getByText("已审批 · 待 ERP 录入").first()).toBeVisible();

  // 已批准后不得再出现回到可编辑态的入口
  await expect(page.getByRole("button", { name: "提交价格复核" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "退回草稿继续修改" })).toHaveCount(0);

  // 审批流两道关都留痕(按钮文案也含这些词,故取表格内的首个匹配)
  await expect(page.getByRole("cell", { name: "价格复核" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "终审", exact: true })).toBeVisible();

  // 生成的在途行应出现在 OPO 页。
  // 换回采购身份:/suppliers/opo 的角色是 PROCUREMENT / SUPPLIER,**不含 MANAGEMENT**
  // (角色模型如此设计,不是缺陷)——用管理层账号去看在途页本来就看不到。
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/suppliers/opo");
  await expect(page.getByText(`E2E-PO-${stamp}`).first()).toBeVisible();

  // ERP 模板可下载
  await page.goto(`/procurement/orders/${id}`);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /下载 ERP 批量下单模板/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^erp-po-E2E-PO-.*\.xlsx$/);
});

test("退回必须记原因;退回后可回草稿继续改", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.ezplm.cn");
  const stamp = Date.now();
  const id = await createPo(page, `E2E-POR-${stamp}`, okLines(`E2E-RPART-${stamp}`));

  await page.getByRole("button", { name: "提交价格复核" }).click();
  await expect(page.getByText("待价格复核").first()).toBeVisible();

  // 不填原因直接退回 → 必须被拒
  await page.getByRole("button", { name: "复核退回" }).click();
  await expect(page.getByTestId("po-action-error")).toContainText("必须填写原因");

  await page.getByLabel(/原因/).fill("单价高于上次成交,要求重新询价");
  await page.getByRole("button", { name: "复核退回" }).click();
  await expect(page.getByText("已退回").first()).toBeVisible();
  await expect(page.getByText(/退回原因:单价高于上次成交/)).toBeVisible();

  // 注意:REJECTED 也是"可编辑"(未冻结),所以不能用「可编辑」判定已回到草稿
  await page.getByRole("button", { name: "退回草稿继续修改" }).click();
  await expect(page.getByText("当前:草稿")).toBeVisible();
  await page.goto(`/procurement/orders/${id}`);
  await expect(page.getByRole("button", { name: "提交价格复核" })).toBeVisible();
});

test("历史价对比:同料第二单涨幅超线时被判异常并挡住提交复核", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.ezplm.cn");
  const stamp = Date.now();
  const mpn = `E2E-HIST-${stamp}`;

  // 第一单:批准成交,形成历史价 8.00(在价格线 12 之内)
  const first = await createPo(
    page,
    `E2E-H1-${stamp}`,
    `MPN,数量,单价,交期\n${mpn},100,8.00,15`,
  );
  await page.getByRole("button", { name: "提交价格复核" }).click();
  await page.getByRole("button", { name: /复核通过/ }).click();
  await page.getByRole("button", { name: /终审通过/ }).click();
  await expect(page.getByText("已审批 · 待 ERP 录入").first()).toBeVisible();
  expect(first).toBeTruthy();

  // 第二单:同料 10.40,涨 30% > 10% 告警线,但仍在价格线内 ——
  // 这样被挡住的原因**只能是涨幅**,不会和"超价格线"混在一起
  await createPo(page, `E2E-H2-${stamp}`, `MPN,数量,单价,交期\n${mpn},100,10.40,15`);
  await expect(page.getByText(/涨幅超线/).first()).toBeVisible();
  await expect(page.getByText(/上涨 30%/).first()).toBeVisible();

  // 未处理异常 → 提交复核被挡,并指名行号
  await page.getByRole("button", { name: "提交价格复核" }).click();
  const err = page.getByTestId("po-action-error");
  await expect(err).toContainText("未处理的价格/交期异常");
  await expect(err).toContainText("第 1 行");
});
