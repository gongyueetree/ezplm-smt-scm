import { expect, test, type Page } from "@playwright/test";

/**
 * 批次级全链路追溯 E2E(PR-C 验收点)。
 *
 * 覆盖纪律:
 * - 收料 → 工单 → 客户 正向追溯;客户/出货 → 工单 → 物料批次 反向追溯;
 * - 同批次影响多个工单;同工单使用多个批次;
 * - **数据缺失时显示未知/缺口,不显示零影响**;
 * - 无权限用户不能执行隔离;隔离先生成待审批任务;
 * - 所有动作写入 AuditLog;
 * - **未接 ERP/MES 时不得显示外部系统已冻结**。
 *
 * 注意用 page.request(独立 request fixture 不带登录 cookie)。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/**
 * 每轮唯一批次号。
 * **不能只用 Date.now()** —— Playwright 并行 worker 可能拿到同一毫秒,
 * 批次号撞车会导致并发写同一唯一键而 500(实测踩到)。加随机后缀。
 */
function uniq(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function ids(stamp: string) {
  return {
    lot: `E2E-LOT-${stamp}`,
    lot2: `E2E-LOT2-${stamp}`,
    wo1: `E2E-WO1-${stamp}`,
    wo2: `E2E-WO2-${stamp}`,
    fg: `E2E-FG-${stamp}`,
    ship: `E2E-SH-${stamp}`,
    po: `E2E-PO-${stamp}`,
    customer: `E2E-客户-${stamp}`,
  };
}

async function seedChain(page: Page, s: ReturnType<typeof ids>) {
  const receipt = await page.request.post("/api/trace/import", {
    data: {
      template: "RECEIPT",
      text: `PO,供应商,MPN,内部批次,收料数量,入库时间\n${s.po},E2E供应商,USB-TYPC-15,${s.lot},5000,2026-04-08\n${s.po},E2E供应商,USB-TYPC-15,${s.lot2},1000,2026-04-09`,
    },
  });
  expect(receipt.status()).toBe(201);

  const issue = await page.request.post("/api/trace/import", {
    data: {
      template: "WO_ISSUE",
      // 同批次进两个工单;WO1 同时用两个批次
      text: `工单号,物料批次,发料数量,发料时间\n${s.wo1},${s.lot},200,2026-04-12\n${s.wo2},${s.lot},300,2026-04-13\n${s.wo1},${s.lot2},50,2026-04-12`,
    },
  });
  expect(issue.status()).toBe(201);

  const ship = await page.request.post("/api/trace/import", {
    data: {
      template: "SHIPMENT",
      text: `成品批次,工单号,客户,出货单号,出货数量,出货日期\n${s.fg},${s.wo1},${s.customer},${s.ship},150,2026-04-25`,
    },
  });
  expect(ship.status()).toBe(201);
}

test("页面:粒度标注为批次级,且明确 SN 待接入、无 MES", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/traceability");
  await expect(page.locator(".page-title")).toHaveText("批次级追溯");
  await expect(page.getByText(/当前追溯粒度:批次级/)).toBeVisible();
  await expect(page.getByText(/不以批次冒充 SN/)).toBeVisible();
  await expect(page.getByText(/本系统没有 MES/)).toBeVisible();
});

test("正向追溯:收料 → 工单 → 客户;同批次影响多个工单", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const s = ids(uniq());
  await seedChain(page, s);

  const res = await page.request.get(`/api/trace/query?q=${encodeURIComponent(s.lot)}`);
  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(body.blastRadius.affectedWorkOrders).toBe(2);
  expect(body.blastRadius.affectedFgLots).toBe(1);
  expect(body.blastRadius.affectedCustomers).toBe(1);
  expect(body.blastRadius.shippedQty).toBe("150");
  expect(body.blastRadius.granularity).toBe("LOT");
});

test("反向追溯:出货 → 工单 → 物料批次;同工单使用多个批次", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const s = ids(uniq());
  await seedChain(page, s);

  const res = await page.request.get(`/api/trace/query?q=${encodeURIComponent(s.ship)}`);
  const body = await res.json();
  const backRefs = (body.backward.layers as string[][]).flat();
  expect(backRefs).toContain(`WO:${s.wo1}`);
  // WO1 用了两个批次,反向应都能追到
  expect(backRefs).toContain(`LOT:${s.lot}`);
  expect(backRefs).toContain(`LOT:${s.lot2}`);
});

test("**数据缺失显示缺口与可能原因,不显示零影响**", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const stamp = uniq();
  const lot = `E2E-ORPHAN-${stamp}`;

  // 只导收料,不导工单用料 → 链路在批次这一跳断掉
  const r = await page.request.post("/api/trace/import", {
    data: {
      template: "RECEIPT",
      text: `PO,内部批次,收料数量\nE2E-PO-${stamp},${lot},1000`,
    },
  });
  expect(r.status()).toBe(201);

  const res = await page.request.get(`/api/trace/query?q=${encodeURIComponent(lot)}`);
  const body = await res.json();
  expect(body.blastRadius.affectedWorkOrders).toBe(0);
  // 关键:必须有缺口说明,而不是安静地报 0
  const gaps = body.blastRadius.gaps as { message: string; possibleCauses: string[] }[];
  expect(gaps.length).toBeGreaterThan(0);
  expect(gaps.map((g) => g.message).join(" ")).toContain("未发现工单用料记录");
  expect(gaps.map((g) => g.message).join(" ")).toContain("不代表没有影响");
  expect(gaps.flatMap((g) => g.possibleCauses).join(" ")).toContain("尚未同步");
});

test("查不到数据时明确说明可能未导入,而不是返回空图", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const res = await page.request.get("/api/trace/query?q=E2E-NOT-EXIST-XYZ");
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain("尚未导入");
});

test("导入:坏行逐行报错;重复导入幂等", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const stamp = uniq();

  const bad = await page.request.post("/api/trace/import", {
    data: { template: "WO_ISSUE", text: `工单号,物料批次,发料数量\nWO-${stamp},L-${stamp},0` },
  });
  expect(bad.status()).toBe(422);
  expect(await bad.text()).toContain("没有业务含义");

  const text = `工单号,物料批次,发料数量\nWO-${stamp},L-${stamp},100`;
  const first = await page.request.post("/api/trace/import", { data: { template: "WO_ISSUE", text } });
  expect(first.status()).toBe(201);
  expect((await first.json()).duplicated).toBe(false);

  const second = await page.request.post("/api/trace/import", { data: { template: "WO_ISSUE", text } });
  expect((await second.json()).duplicated).toBe(true);
});

test("隔离处置:无权限不能批准;提议先进待审批;**不得显示外部系统已冻结**", async ({ page }) => {
  test.setTimeout(180_000);
  const s = ids(uniq());
  await login(page, "engineering@demo.qianchuang.cn");
  await seedChain(page, s);

  const inc = await page.request.post("/api/trace/incidents", {
    data: { code: `QI-${Date.now()}`, title: "E2E 异常", sourceRef: `LOT:${s.lot}` },
  });
  expect(inc.status()).toBe(201);
  const { id: incidentId } = await inc.json();

  const propose = await page.request.post(`/api/trace/incidents/${incidentId}/containment`, {
    data: { actions: [{ kind: "FREEZE_LOT", targetRef: `LOT:${s.lot}` }] },
  });
  expect(propose.status()).toBe(201);
  const pb = await propose.json();
  expect(pb.note).toContain("尚未执行任何冻结");
  const actionId = pb.ids[0];

  // 工程只能提议,不能批准
  const denied = await page.request.post(`/api/trace/containment/${actionId}/approve`, {
    data: { decision: "APPROVE" },
  });
  expect(denied.status()).toBe(403);
  expect(await denied.text()).toContain("trace.containment.approve");

  // 管理层批准 → 只到「本系统已登记」,且明说外部未执行
  await login(page, "management@demo.qianchuang.cn");
  const ok = await page.request.post(`/api/trace/containment/${actionId}/approve`, {
    data: { decision: "APPROVE" },
  });
  expect(ok.status()).toBe(200);
  const ob = await ok.json();
  expect(ob.state).toBe("REGISTERED_LOCALLY");
  expect(ob.note).toContain("ERP/WMS 回写待执行");
  expect(ob.note).toContain("MES 联动未接入");

  // 页面上不得出现「ERP 已冻结」「设备已停机」这类外部完成态
  await page.goto("/traceability");
  await expect(page.getByText("本系统已登记").first()).toBeVisible();
  expect(await page.getByText("ERP 已冻结").count()).toBe(0);
  expect(await page.getByText("设备已停机").count()).toBe(0);
});

test("提议人不能批准自己提的动作(提议与批准分离)", async ({ page }) => {
  test.setTimeout(120_000);
  const s = ids(uniq());
  await login(page, "management@demo.qianchuang.cn");
  await seedChain(page, s);

  const inc = await page.request.post("/api/trace/incidents", {
    data: { code: `QI-SELF-${Date.now()}`, title: "自审用例", sourceRef: `LOT:${s.lot}` },
  });
  const { id } = await inc.json();
  const propose = await page.request.post(`/api/trace/incidents/${id}/containment`, {
    data: { actions: [{ kind: "MARK_RECHECK", targetRef: `LOT:${s.lot}` }] },
  });
  const actionId = (await propose.json()).ids[0];

  const self = await page.request.post(`/api/trace/containment/${actionId}/approve`, {
    data: { decision: "APPROVE" },
  });
  expect(self.status()).toBe(422);
  expect(await self.text()).toContain("提议与批准必须分离");
});

test("追溯动作写入 AuditLog", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const s = ids(uniq());
  await seedChain(page, s);

  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings");
  await expect(page.getByText("TRACE_IMPORT").first()).toBeVisible({ timeout: 30_000 });
});

test("**供应商受限视图**:只见自己的批次与上游,看不到工单/客户,且隐藏数被报出来", async ({ page }) => {
  test.setTimeout(180_000);
  const s = ids(uniq());

  // 内部账号先建链路,供应商用「华强北电子(示例)」= 种子里 SUP-A 的名称
  await login(page, "engineering@demo.qianchuang.cn");
  await page.request.post("/api/trace/import", {
    data: {
      template: "RECEIPT",
      text: `PO,供应商,内部批次,收料数量\n${s.po},华强北电子(示例),${s.lot},5000`,
    },
  });
  await page.request.post("/api/trace/import", {
    data: { template: "WO_ISSUE", text: `工单号,物料批次,发料数量\n${s.wo1},${s.lot},200` },
  });
  await page.request.post("/api/trace/import", {
    data: {
      template: "SHIPMENT",
      text: `成品批次,工单号,客户,出货单号,出货数量\n${s.fg},${s.wo1},${s.customer},${s.ship},150`,
    },
  });

  // 内部视图:完整链路可见
  const inner = await page.request.get(`/api/trace/query?q=${encodeURIComponent(s.lot)}`);
  const ib = await inner.json();
  expect(ib.blastRadius.affectedCustomers).toBe(1);
  expect(ib.truncatedEdges).toBe(0);
  expect(ib.scopeNote).toContain("完整链路");

  // 供应商视图:同一个批次
  await login(page, "supplier@demo.qianchuang.cn");
  const res = await page.request.get(`/api/trace/query?q=${encodeURIComponent(s.lot)}`);
  expect(res.status()).toBe(200);
  const body = await res.json();

  // 纵向:看不到工单、成品、出货、客户
  expect(body.blastRadius.affectedWorkOrders).toBe(0);
  expect(body.blastRadius.affectedCustomers).toBe(0);
  const text = JSON.stringify(body);
  expect(text).not.toContain(s.wo1);
  expect(text).not.toContain(s.customer);
  expect(text).not.toContain(s.fg);

  // 但必须说明这是受限视图 + 隐藏了多少条,不能被读成"下游没影响"
  expect(body.truncatedEdges).toBeGreaterThan(0);
  expect(body.truncatedNotice).toContain("受限视图");
  expect(body.truncatedNotice).toContain("隐藏不等于没有影响");
  expect(body.scopeNote).toContain("不对供应商开放");
});

test("**供应商查别家批次被拒,且措辞与「不存在」一致(不能拿来枚举)**", async ({ page }) => {
  test.setTimeout(120_000);
  const s = ids(uniq());
  await login(page, "engineering@demo.qianchuang.cn");
  await page.request.post("/api/trace/import", {
    data: { template: "RECEIPT", text: `PO,供应商,内部批次,收料数量\n${s.po},别家供应商,${s.lot},100` },
  });

  await login(page, "supplier@demo.qianchuang.cn");
  const other = await page.request.get(`/api/trace/query?ref=${encodeURIComponent(`LOT:${s.lot}`)}`);
  expect(other.status()).toBe(404);
  const otherText = await other.text();

  const nonexistent = await page.request.get("/api/trace/query?ref=LOT:E2E-NEVER-EXISTED");
  expect(nonexistent.status()).toBe(404);

  // 两种情况的响应必须一样,否则可以据此判断某个批次号是否真实存在
  expect(otherText).toBe(await nonexistent.text());
});

/**
 * A-3 回归:结论置信度**必须显示在页面上**。
 *
 * 之前的缺陷不是"算错了",而是接口算出的 coverage / conclusionCaveat /
 * truncatedNotice **前端一个都没渲染** —— 页面只显示四个漂亮的影响面 KPI。
 * 使用者据此做隔离与召回决策,却看不到"这份结论有多可信"。
 *
 * 截断本身需要 2 万条边才能触发,不适合在 E2E 里造;这里守的是
 * 「同一条通道确实通到 UI」——截断提示走的正是这条通道。
 */
test("追溯结论必须在页面上给出置信度与限定措辞,而不是只显示 KPI", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const s = ids(uniq());
  await seedChain(page, s);

  await page.goto("/traceability");
  await page.getByLabel("查询条件").fill(s.lot);
  await page.getByRole("button", { name: "开始追溯" }).click();

  const conf = page.getByTestId("trace-confidence");
  await expect(conf).toBeVisible();
  await expect(conf).toContainText("结论置信度");

  // 措辞必须是三档之一,且不能是空壳标签
  await expect(conf).toContainText(/结论置信度:(高|中|低)/);
  // 非高置信度时必须写清"只反映已导入数据的范围"这类限定语,
  // 高置信度时才允许说可直接用于决策 —— 两者不得同时出现
  const text = (await conf.textContent()) ?? "";
  if (/结论置信度:高/.test(text)) {
    expect(text).toContain("可直接用于");
  } else {
    expect(text).toMatch(/不代表真实影响面|建议补齐/);
    expect(text).not.toContain("可直接用于");
  }
});
