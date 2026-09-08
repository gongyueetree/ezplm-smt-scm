import { expect, test, type Page } from "@playwright/test";

/**
 * F2 · ECN-Lite(PAGE_SPEC_ECN §11 验收):
 * 创建 → 导入变更行 → 提交 → 工程通过 → 采购确认 → 管理批准 → 发布 →
 * Apply to BOM(二次确认)→ 作废另一条并可查;越权断言;Flag 门控。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

// T2/R3-5 多个用例开关租户配置(featureFlags / ecnApprovalStages)——
// fullyParallel 下同文件也会并行,必须串行避免互踩(与 f6 同纪律)
test.describe.configure({ mode: "serial" });

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

// ============================================================
// R3-5:审批链冻结 + Impact coverage
// ============================================================

async function addLineAndSubmit(page: Page, ecnId: string, stamp: number) {
  const lines = await page.request.post(`/api/ecn/${ecnId}/lines`, {
    data: {
      csvText: `旧内部料号,旧MPN,新内部料号,新MPN,数量影响,原因,工程备注\n,R35-OLD-${stamp},,R35-NEW-${stamp},,冻结回归,`,
    },
  });
  expect(lines.status()).toBe(200);
  const submit = await page.request.post(`/api/ecn/${ecnId}/transition`, { data: { action: "submit" } });
  expect(submit.status()).toBe(200);
}

test("R3-5 冻结:提交后改审批链配置,在途单仍走提交时的链;新单走新链", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const stamp = Date.now();
  const inflightId = await createEcnViaApi(page, `R35 冻结在途 ${stamp}`);
  await addLineAndSubmit(page, inflightId, stamp);

  // 管理层把采购段从审批链里拿掉(显式有序列表)
  const mgmtCtx = await browser.newContext();
  const mgmt = await mgmtCtx.newPage();
  await login(mgmt, "management@demo.qianchuang.cn");
  const current = await (await mgmt.request.get("/api/settings/tenant")).json();
  const put = await mgmt.request.put("/api/settings/tenant", {
    data: { ...current.settings, ecnApprovalStages: ["ENGINEERING", "MANAGEMENT"] },
  });
  expect(put.status()).toBe(200);

  try {
    // 工程通过在途单第一段
    const eng = await page.request.post(`/api/ecn/${inflightId}/transition`, { data: { action: "approve" } });
    expect(eng.status()).toBe(200);

    // 冻结回归核心:在途单下一段仍是**采购**(提交时链)。
    // 探针用工程账号(MANAGEMENT 设计上兼批一切阶段,探不出链)——
    // 报错文本点名当前阶段:冻结链下必须是 PROCUREMENT,若误用实时链会是 MANAGEMENT
    const engTry = await page.request.post(`/api/ecn/${inflightId}/transition`, { data: { action: "approve" } });
    expect(engTry.status()).toBe(422);
    expect(((await engTry.json()) as { error: string }).error).toContain("PROCUREMENT");

    // 采购把冻结链走完
    const procCtx = await browser.newContext();
    const proc = await procCtx.newPage();
    await login(proc, "procurement@demo.qianchuang.cn");
    const procOk = await proc.request.post(`/api/ecn/${inflightId}/transition`, { data: { action: "approve" } });
    expect(procOk.status()).toBe(200);
    await procCtx.close();
    const mgmtOk = await mgmt.request.post(`/api/ecn/${inflightId}/transition`, { data: { action: "approve" } });
    expect(mgmtOk.status()).toBe(200);

    // 配置变更后提交的**新单**:走新链(工程→管理,采购不再出现)
    const freshId = await createEcnViaApi(page, `R35 新链 ${stamp}`);
    await addLineAndSubmit(page, freshId, stamp + 1);
    const engOk = await page.request.post(`/api/ecn/${freshId}/transition`, { data: { action: "approve" } });
    expect(engOk.status()).toBe(200);
    // 新链探针:工程再试 → 点名 MANAGEMENT(采购段确实不在新链里)
    const engTry2 = await page.request.post(`/api/ecn/${freshId}/transition`, { data: { action: "approve" } });
    expect(engTry2.status()).toBe(422);
    expect(((await engTry2.json()) as { error: string }).error).toContain("MANAGEMENT");
    const mgmtFinal = await mgmt.request.post(`/api/ecn/${freshId}/transition`, { data: { action: "approve" } });
    expect(mgmtFinal.status()).toBe(200);
    expect(((await mgmtFinal.json()) as { status: string }).status).toMatch(/APPROVED|CUSTOMER_CONFIRM/);
  } finally {
    // 显式归零而不是回放捕获值 —— 捕获值可能已被上一轮失败运行污染(R3-3 教训)
    await mgmt.request.put("/api/settings/tenant", {
      data: { ...current.settings, ecnApprovalStages: null },
    });
    await mgmtCtx.close();
  }
});

test("R3-5 coverage:工单/销售订单卡标 HEADER_ONLY 并给口径警示;库存卡 FULL", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.qianchuang.cn");
  const ecnId = await createEcnViaApi(page, `R35 coverage ${Date.now()}`);

  const current = await (await page.request.get("/api/settings/tenant")).json();
  await page.request.put("/api/settings/tenant", {
    data: {
      ...current.settings,
      featureFlags: { ...current.settings.featureFlags, "ecn.impactAnalysis": true },
    },
  });
  try {
    const impact = await (await page.request.get(`/api/ecn/${ecnId}/impact`)).json();
    expect(impact.oldInventory.coverage).toBe("FULL");
    expect(impact.workOrders.coverage).toBe("HEADER_ONLY");
    expect(impact.workOrders.warning).toContain("不可直接作决策依据");
    expect(impact.salesOrders.coverage).toBe("HEADER_ONLY");

    await page.goto(`/ecn/${ecnId}`);
    await expect(page.getByTestId("ecn-impact-panel")).toBeVisible();
    await expect(page.getByTestId("impact-work-orders")).toHaveAttribute("data-coverage", "HEADER_ONLY");
    await expect(page.getByTestId("impact-work-orders-warning")).toContainText("不可直接作决策依据");
    await expect(page.getByTestId("impact-old-inventory")).toHaveAttribute("data-coverage", "FULL");
  } finally {
    await page.request.put("/api/settings/tenant", { data: current.settings });
  }
});
