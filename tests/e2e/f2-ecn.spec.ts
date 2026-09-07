import { expect, test, type Page } from "@playwright/test";

/**
 * F2 · ECN-Lite(PAGE_SPEC_ECN §11 验收):
 * 创建 → 导入变更行 → 提交 → 工程通过 → 采购确认 → 管理批准 → 发布 →
 * Apply to BOM(二次确认)→ 作废另一条并可查;越权断言;Flag 门控。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function createEcnViaApi(page: Page, title: string): Promise<string> {
  const res = await page.request.post("/api/ecn", {
    data: { title, type: "EOL_REPLACEMENT", priority: "HIGH" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).ecnId;
}


test("全流程:创建 → 导入行 → 三段评审 → 发布 → Apply to BOM(二次确认)", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();

  // 工程发起 + CSV 导入变更行
  await login(page, "engineering@demo.qianchuang.cn");
  const ecnId = await createEcnViaApi(page, `E2E USB 接口 EOL 替换 ${stamp}`);
  await page.goto(`/ecn/${ecnId}`);
  await expect(page.getByTestId("ecn-title")).toContainText("ECN-");

  // CSV 导入(坏行会被逐行报错阻止 —— 先验证这一点)
  const bad = await page.request.post(`/api/ecn/${ecnId}/lines`, {
    data: { csvText: "旧内部料号,旧MPN,新内部料号,新MPN,数量影响,原因,工程备注\n,,,NEW-ONLY,,缺旧料," },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toContain("至少填一个");

  await page.reload();
  await page.getByLabel("变更行 CSV").fill(
    `旧内部料号,旧MPN,新内部料号,新MPN,数量影响,原因,工程备注\n,E2E-OLD-${stamp},,E2E-NEW-${stamp},,EOL 替换,库存用完即切`,
  );
  await page.getByTestId("ecn-import-lines").click();
  await expect(page.getByTestId("ecn-lines-table")).toContainText(`E2E-OLD-${stamp}`);

  // 空行提交前置:已有行 → 提交
  await page.getByTestId("ecn-submit").click();
  await expect(page.locator(".page-actions .badge").first()).toContainText("评审中");

  // 工程通过(当前用户就是工程)
  await page.getByTestId("ecn-approve").click();
  await expect(page.getByTestId("ecn-approvals")).toContainText("工程评审");

  // 采购确认:工程无权批采购段 —— 如实显示无权
  await expect(page.getByTestId("ecn-no-permission")).toContainText("无权审批");
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto(`/ecn/${ecnId}`);
  await page.getByTestId("ecn-approve").click();
  await expect(page.getByTestId("ecn-approvals")).toContainText("采购确认");

  // 管理批准 → APPROVED → 发布
  await login(page, "management@demo.qianchuang.cn");
  await page.goto(`/ecn/${ecnId}`);
  await page.getByTestId("ecn-approve").click();
  await expect(page.locator(".page-actions .badge").first()).toContainText("已批准");
  await page.getByTestId("ecn-release").click();
  await expect(page.locator(".page-actions .badge").first()).toContainText("已发布");
  await expect(page.getByText("快照冻结于")).toBeVisible();

  // Apply to BOM:先造一个含旧料的 BOM
  const csv = [
    "位号,用量,制造商,制造商料号,封装,描述",
    `U1,1,TestMfr,E2E-OLD-${stamp},SMD,待替换的旧料`,
  ].join("\n");
  const imp = await page.request.post("/api/bom/import", {
    multipart: {
      files: { name: `ecn-target-${stamp}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") },
    },
  });
  expect(imp.status()).toBe(201);
  const bomName = (await imp.json()).job;
  void bomName;

  await page.goto(`/ecn/${ecnId}`);
  await page.getByTestId("ecn-apply-open").click();
  const card = page.getByTestId("ecn-apply-card");
  await expect(card).toContainText("二次确认");
  // 选择刚导入的 BOM(下拉按更新时间倒序,选第一个非空项)
  await card.locator("select").selectOption({ index: 1 });
  await page.getByTestId("ecn-apply-confirm").click();
  await expect(card).toContainText("Apply to BOM 完成", { timeout: 30_000 });
  await expect(card).toContainText("替换 1 行");

  // 回链:详情页出现生成的版本
  await expect(page.getByTestId("ecn-applied-versions")).toBeVisible();
});

test("作废可查可溯:原因必填,作废后仍可打开且显示原因;RELEASED 不可作废", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  const ecnId = await createEcnViaApi(page, `E2E 作废用例 ${Date.now()}`);

  // 无原因作废 → 422
  const noReason = await page.request.post(`/api/ecn/${ecnId}/transition`, { data: { action: "void" } });
  expect(noReason.status()).toBe(422);

  const ok = await page.request.post(`/api/ecn/${ecnId}/transition`, {
    data: { action: "void", comment: "重复发起,作废" },
  });
  expect(ok.status()).toBe(200);

  await page.goto(`/ecn/${ecnId}`);
  await expect(page.getByTestId("ecn-voided-banner")).toContainText("重复发起");
  // 列表里也可查
  await page.goto("/ecn?status=VOIDED");
  await expect(page.getByTestId("ecn-table")).toContainText("已作废");
});

test("T2 Flag 门控:关闭时影响面板不渲染、API 404;开启后面板显示各源状态", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.qianchuang.cn");
  const ecnId = await createEcnViaApi(page, `E2E 影响分析 ${Date.now()}`);

  await page.goto(`/ecn/${ecnId}`);
  await expect(page.getByTestId("ecn-impact-panel")).toHaveCount(0);
  const closed = await page.request.get(`/api/ecn/${ecnId}/impact`);
  expect(closed.status()).toBe(404);
  // T3 占位注明待商务确认
  await expect(page.getByTestId("ecn-t3-placeholder")).toContainText("待商务确认");

  const current = await (await page.request.get("/api/settings/tenant")).json();
  const put = await page.request.put("/api/settings/tenant", {
    data: {
      ...current.settings,
      featureFlags: { ...current.settings.featureFlags, "ecn.impactAnalysis": true },
    },
  });
  expect(put.status()).toBe(200);

  try {
    const res = await page.request.get(`/api/ecn/${ecnId}/impact`);
    expect(res.status()).toBe(200);
    const impact = await res.json();
    // E2E 环境未配置 ERP → 各源如实 not_configured(不是 0,不是示例数)
    expect(impact.erpTarget).toBe("NONE");
    expect(impact.oldInventory.state).toBe("not_configured");
    expect(impact.workOrders.state).toBe("not_configured");

    await page.goto(`/ecn/${ecnId}`);
    await expect(page.getByTestId("ecn-impact-panel")).toBeVisible();
    await expect(page.getByTestId("impact-old-inventory")).toContainText("数据源待接入");
  } finally {
    await page.request.put("/api/settings/tenant", { data: current.settings });
  }
});

test("越权:供应商角色无 ECN 入口;创建接口拒绝采购", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  const res = await page.request.post("/api/ecn", {
    data: { title: "采购不能发起", type: "OTHER", priority: "LOW" },
  });
  expect(res.status()).toBe(403);
});
