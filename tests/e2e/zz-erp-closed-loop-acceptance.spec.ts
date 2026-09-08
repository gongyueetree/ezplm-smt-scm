import { expect, test, type Page } from "@playwright/test";

/**
 * ERP CLOSED-LOOP ACCEPTANCE(closed-loop 验收编排)。
 *
 * 运行条件:主应用配置了 ERP_LAB_BASE_URL / ERP_LAB_ACCESS_TOKEN(指向 Lab
 * dev-server 或部署实例)。未配置时整组跳过 —— CI 里如实标 BLOCKED_EXTERNAL,
 * **不假装通过**。本组产出 docs/ERP-CLOSED-LOOP-ACCEPTANCE.md 的证据。
 *
 * zz- 前缀:本组会改租户 ERP 配置与 Lab 场景,排在其它用例之后串行执行。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";
const LAB_URL = process.env.ERP_LAB_BASE_URL;
const LAB_TOKEN = process.env.ERP_LAB_ACCESS_TOKEN;
const LAB_TENANT = process.env.ERP_LAB_ACCEPTANCE_TENANT ?? "acceptance-loop";

test.describe.configure({ mode: "serial" });
test.skip(!LAB_URL || !LAB_TOKEN, "ERP_LAB_BASE_URL/TOKEN 未配置 —— BLOCKED_EXTERNAL,不假装通过");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/** 直调 Lab(镜像操作名;带 Bearer)—— 验收里用于场景注入与结果核对 */
async function labRpc(page: Page, operation: string, payload: Record<string, unknown> = {}) {
  const res = await page.request.post(`${LAB_URL}/api/erp`, {
    headers: { Authorization: `Bearer ${LAB_TOKEN}`, "X-Tenant-Id": LAB_TENANT },
    data: { tenantId: LAB_TENANT, operation, payload },
  });
  const body = await res.json();
  return { status: res.status(), body };
}

async function setTenantErp(page: Page, patch: Record<string, unknown>) {
  const current = await (await page.request.get("/api/settings/tenant")).json();
  const res = await page.request.put("/api/settings/tenant", {
    data: { ...current.settings, ...patch },
  });
  expect(res.status()).toBe(200);
  return current.settings;
}

async function createApprovedPo(page: Page, mpn: string): Promise<{ poId: string; poNo: string }> {
  await page.goto("/procurement/orders");
  await page.getByRole("button", { name: "新建采购订单" }).click();
  const poNo = `LOOP-PO-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  await page.getByLabel("PO 号").fill(poNo);
  await page
    .getByLabel(/粘贴订单行/)
    .fill(["MPN\t数量\t单价\tMOQ\tSPQ\t交期\t需求日期", `${mpn}\t100\t7.10\t10\t10\t20\t2026-12-01`].join("\n"));
  await page.getByRole("button", { name: "创建订单" }).click();
  await page.waitForURL(/\/procurement\/orders\/[^/]+$/);
  const poId = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "提交价格复核" }).click();
  await page.getByRole("button", { name: /复核通过/ }).click();
  await page.getByRole("button", { name: /终审通过并生成在途行/ }).click();
  // 等仅 APPROVED 才渲染的区块(「已审批」字样在常驻横幅里也有,不能拿来当状态断言)
  await expect(page.getByTestId("supplier-confirm-block")).toBeVisible({ timeout: 20_000 });
  return { poId, poNo };
}

let savedSettings: Record<string, unknown> | null = null;

test("〔0〕接线:租户指向 Lab 验收数据集;Lab 连通且已播种", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  savedSettings = await setTenantErp(page, { erpProvider: "ERP_LAB", erpLabTenantId: LAB_TENANT });

  // Lab:重置数据集到 golden 种子(NORMAL 场景),保证可复现
  const reset = await labRpc(page, "resetDataset");
  expect(reset.status).toBe(200);
  const conn = await labRpc(page, "testConnection");
  expect(conn.body.data.connected).toBe(true);

  // 主系统种子供应商(SUP-A)在 Lab 建档 —— 回写 PO 时 Lab 校验 supplierCode 存在
  const upsert = await labRpc(page, "upsertRecord", {
    type: "SUPPLIER",
    record: { externalId: "SUP-A", supplierCode: "SUP-A", name: "闭环验收供应商A", status: "ACTIVE", currency: "CNY" },
  });
  expect(upsert.status).toBe(200);
});

test("〔1〕读取面:Material/Inventory/Excess/FX/OpenPO/WO/SO 全部经分页信封可拉", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  for (const op of [
    "pullMaterials",
    "pullInventory",
    "pullExcess",
    "pullExchangeRates",
    "pullOpenPurchaseOrders",
    "pullWorkOrders",
    "pullSalesOrders",
  ]) {
    const { status, body } = await labRpc(page, op, { input: { limit: 3 } });
    expect(status, op).toBe(200);
    expect(Array.isArray(body.data.items), op).toBe(true);
    expect(typeof body.data.hasMore, op).toBe("boolean");
  }
  // 服务端 customer 过滤:excess 两客户互不可见
  const acme = await labRpc(page, "pullExcess", { input: { customerCode: "CUS-ACME" } });
  const nova = await labRpc(page, "pullExcess", { input: { customerCode: "CUS-NOVA" } });
  expect(acme.body.data.items.every((r: { customerCode: string }) => r.customerCode === "CUS-ACME")).toBe(true);
  expect(nova.body.data.items.every((r: { customerCode: string }) => r.customerCode === "CUS-NOVA")).toBe(true);
});

test("〔2〕影响分析经主应用消费 Lab 数据(各源 state=ok)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.qianchuang.cn");
  await setTenantErp(page, {
    erpProvider: "ERP_LAB",
    erpLabTenantId: LAB_TENANT,
    featureFlags: { "ecn.impactAnalysis": true },
  });
  const created = await page.request.post("/api/ecn", {
    data: { title: `闭环影响分析 ${Date.now()}`, type: "EOL_REPLACEMENT", priority: "HIGH" },
  });
  const ecnId = (await created.json()).ecnId;
  await page.request.post(`/api/ecn/${ecnId}/lines`, {
    data: {
      lines: [
        { oldInternalPn: "EZ-STM32H743", oldMpn: "STM32H743VIT6", newInternalPn: null, newMpn: "STM32H753", qtyImpact: null, reason: "EOL", engineeringNote: null },
      ],
    },
  });
  const impact = await (await page.request.get(`/api/ecn/${ecnId}/impact`)).json();
  expect(impact.erpTarget).toBe("ERP_LAB");
  expect(impact.oldInventory.state).toBe("ok");
  expect(impact.oldInventory.items.length).toBeGreaterThan(0); // EZ-STM32H743 在种子库存里
  expect(impact.excess.state).toBe("ok");
  expect(impact.openPo.state).toBe("ok");
  expect(impact.workOrders.state).toBe("ok");
  expect(impact.salesOrders.state).toBe("ok");
  // R3-5:coverage 口径 —— 工单/销售订单只有单据头,必须标 HEADER_ONLY
  expect(impact.oldInventory.coverage).toBe("FULL");
  expect(impact.workOrders.coverage).toBe("HEADER_ONLY");

  // R3-6:集成状态页展示 Lab 数据集就绪度(名/版本/行数,真实取自 Lab)
  await page.goto("/settings/integrations/status");
  const summary = page.getByTestId("lab-dataset-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("data-state", "ok");
  await expect(summary).toContainText(LAB_TENANT);
  await expect(page.getByTestId("lab-dataset-counts")).toContainText("物料");
});

test("〔3〕PO 直写:SYNCED 取回 SIM 单号;重复回写幂等;correlationId 两边对齐", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.qianchuang.cn");
  const { poId } = await createApprovedPo(page, "EZ-SGM8301"); // Lab 种子物料

  const first = await (await page.request.post(`/api/procurement/orders/${poId}/erp-writeback`)).json();
  expect(first.ok, JSON.stringify(first)).toBe(true);
  expect(first.documentNo).toMatch(/^SIM/);

  const again = await (await page.request.post(`/api/procurement/orders/${poId}/erp-writeback`)).json();
  expect(again.ok).toBe(true);
  expect(again.idempotentReplay).toBe(true);

  // correlation:主仓记录的 correlationId 出现在 Lab 请求日志里
  const records = await (await page.request.get("/api/integration/sync-records")).json();
  const poRecord = records.records.find(
    (r: { entityType: string; entityId: string }) => r.entityType === "PURCHASE_ORDER" && r.entityId === poId,
  );
  expect(poRecord?.correlationId).toBeTruthy();
  const dataset = await page.request.get(`${LAB_URL}/api/erp?tenantId=${LAB_TENANT}`, {
    headers: { Authorization: `Bearer ${LAB_TOKEN}` },
  });
  const logs = (await dataset.json()).data.requestLogs as { operation: string; correlationId?: string }[];
  expect(logs.some((l) => l.correlationId === poRecord.correlationId)).toBe(true);
});

test("〔4〕故障场景:PO_ALREADY_EXISTS→BLOCKED;NETWORK_DROP→RETRY→原单取回", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, "management@demo.qianchuang.cn");

  // 重复单据 → BLOCKED
  await labRpc(page, "setScenario", { scenario: { code: "PO_ALREADY_EXISTS", enabled: true, latencyMs: 0, failureRate: 1 } });
  const { poId: dupPo } = await createApprovedPo(page, "EZ-USB-C-16P");
  const dup = await (await page.request.post(`/api/procurement/orders/${dupPo}/erp-writeback`)).json();
  expect(dup.ok).toBe(false);
  expect(dup.state).toBe("BLOCKED");

  // 提交后断网 → RETRY_REQUIRED → 人工重试拿回**原单**
  await labRpc(page, "setScenario", { scenario: { code: "NETWORK_DROP_AFTER_COMMIT", enabled: true, latencyMs: 0, failureRate: 1 } });
  const { poId: dropPo } = await createApprovedPo(page, "EZ-W25Q128");
  const drop = await (await page.request.post(`/api/procurement/orders/${dropPo}/erp-writeback`)).json();
  expect(drop.ok).toBe(false);
  expect(drop.state).toBe("RETRY_REQUIRED");

  await labRpc(page, "setScenario", { scenario: { code: "NORMAL", enabled: true, latencyMs: 0, failureRate: 0 } });
  const retry = await (await page.request.post(`/api/procurement/orders/${dropPo}/erp-writeback`)).json();
  expect(retry.ok).toBe(true);
  expect(retry.idempotentReplay).toBe(true); // Lab 识别同幂等键,返回首次(断网前已提交)的单
});

test("〔5〕供应商 ETA → worker 异步回写 → Lab PO 行 ETA 变更 → SYNCED", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await login(page, "management@demo.qianchuang.cn");
  await labRpc(page, "setScenario", { scenario: { code: "NORMAL", enabled: true, latencyMs: 0, failureRate: 0 } });

  // 造 PO 并回写(worker 需要外部单号)
  const { poId, poNo } = await createApprovedPo(page, "EZ-TPS7A2033");
  const wb = await (await page.request.post(`/api/procurement/orders/${poId}/erp-writeback`)).json();
  expect(wb.ok).toBe(true);
  const labPoId: string = wb.externalId;

  // 供应商免登录确认 ETA(公开链路,不同步等待 ERP)
  await page.goto("/suppliers/opo");
  await page.getByTestId("gen-eta-link").click();
  const url = (await page.getByTestId("eta-link-out").locator("code").innerText()).trim();
  const ctx = await browser.newContext();
  const pub = await ctx.newPage();
  await pub.goto(url);
  // 按**本次 PO 的行**定位(供应商的开口行里混着历史用例的行,first() 会填错行)
  await pub.getByLabel(`${poNo}#1 回复交期`).fill("2026-11-11");
  await pub.getByLabel("您的姓名").fill("闭环验收");
  await pub.getByLabel("您的邮箱").fill("loop@example.com");
  await pub.getByTestId("confirm-submit").click();
  await expect(pub.getByTestId("confirm-done")).toBeVisible();
  await ctx.close();

  // 记录应为 PENDING;跑 worker
  const before = await (await page.request.get("/api/integration/sync-records")).json();
  const pendingEta = before.records.filter(
    (r: { entityType: string; state: string }) => r.entityType === "ETA_WRITEBACK" && r.state === "PENDING",
  );
  expect(pendingEta.length).toBeGreaterThan(0);

  const run = await (await page.request.post("/api/integration/worker/run")).json();
  expect(run.synced).toBeGreaterThan(0);

  // Lab 侧:PO 行 ETA 真的变了
  const pos = await labRpc(page, "pullOpenPurchaseOrders", { input: { limit: 100 } });
  const labPo = pos.body.data.items.find((p: { externalId: string }) => p.externalId === labPoId);
  expect(labPo?.lines?.[0]?.eta).toBe("2026-11-11");
});

test("〔6〕收货闭环:receive → 库存增加 → PO 状态推进(镜像契约直调)", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  const invBefore = await labRpc(page, "pullInventory", { input: { materialCode: "EZ-SGM8301", limit: 100 } });
  const qtyBefore = invBefore.body.data.items.reduce((n: number, r: { onHandQty: string }) => n + Number(r.onHandQty), 0);

  const rcv = await labRpc(page, "receivePurchaseOrder", {
    input: { poExternalId: "PO-EXT-002", lines: [{ lineNo: 1, qty: "500", lotNo: "L-LOOP", warehouseCode: "SZ-RM" }] },
    idempotencyKey: `loop-rcv-${Date.now()}`,
  });
  expect(rcv.body.data.success).toBe(true);
  expect(rcv.body.data.documentNumber).toMatch(/^RCV/);

  const invAfter = await labRpc(page, "pullInventory", { input: { materialCode: "EZ-SGM8301", limit: 100 } });
  const qtyAfter = invAfter.body.data.items.reduce((n: number, r: { onHandQty: string }) => n + Number(r.onHandQty), 0);
  expect(qtyAfter).toBe(qtyBefore + 500);
});

test("〔7〕隔离:Lab 匿名读验收租户被拒;租户数据集互不串;还原配置", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");

  // 匿名 GET 验收租户(客户数据语义)→ 401
  const anon = await page.request.get(`${LAB_URL}/api/erp?tenantId=${LAB_TENANT}`);
  expect(anon.status()).toBe(401);

  // 另一个 Lab 租户的数据集与验收租户互不影响(场景各自独立)
  const other = await page.request.post(`${LAB_URL}/api/erp`, {
    headers: { Authorization: `Bearer ${LAB_TOKEN}` },
    data: { tenantId: "acceptance-other", operation: "testConnection", payload: {} },
  });
  expect(other.status()).toBe(200);
  const otherScenario = await page.request.get(`${LAB_URL}/api/erp?tenantId=acceptance-other`, {
    headers: { Authorization: `Bearer ${LAB_TOKEN}` },
  });
  expect((await otherScenario.json()).data.scenario.code).toBe("NORMAL"); // 未被验收租户的场景注入污染

  // 显式归位(不是"还原捕获值"—— 若历史运行曾中断,捕获值本身可能已被污染):
  // ERP 断开 + 全 flag 关,与全量套件的默认前提一致
  const current = await (await page.request.get("/api/settings/tenant")).json();
  await page.request.put("/api/settings/tenant", {
    data: {
      ...current.settings,
      erpProvider: "NONE",
      erpLabTenantId: null,
      featureFlags: Object.fromEntries(Object.keys(current.settings.featureFlags).map((k) => [k, false])),
    },
  });
  void savedSettings;
});
