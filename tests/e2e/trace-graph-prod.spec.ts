import { expect, test, type Page } from "@playwright/test";

/**
 * PR-E 生产加固 E2E:Trace Graph 增强。
 *
 * 覆盖三条最容易做错的口径:
 * - 影响面结论必须带**置信度与措辞约束**,低置信度不得断言「无影响」;
 * - 批次拆分要**同时补图边**,否则链路在拆分处断掉;
 * - 替代料**无批准人时必须显式警示**,不能静默接受。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("**影响面结论带置信度与措辞约束**,低置信度不得断言无影响", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const stamp = Date.now();

  // 只导收料模板 → 后续段全缺 → 必然低置信度
  const lot = `E2E-COV-${stamp}`;
  const imp = await page.request.post("/api/trace/import", {
    data: {
      template: "RECEIPT",
      text: `PO,内部批次,收料数量,入库时间\nPO-COV-${stamp},${lot},5000,2026-04-08`,
    },
  });
  expect(imp.status()).toBe(201);

  const res = await page.request.post("/api/traceability/analysis", {
    data: { sourceRef: `LOT:${lot}` },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();

  expect(["HIGH", "MEDIUM", "LOW"]).toContain(body.confidence);
  expect(body.confidence).toBe("LOW");
  // 关键:低置信度必须明写不得据此判定「无影响」
  expect(body.caveat).toContain("不得据此判定");
  expect(body.caveat).toContain("无影响");
});

test("分析快照可查:同一起点的历史分析留痕", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const list = await page.request.get("/api/traceability/analysis");
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(Array.isArray(body.runs)).toBe(true);
  for (const r of body.runs) {
    expect(["HIGH", "MEDIUM", "LOW"]).toContain(r.confidence);
    expect(typeof r.coverageScore).toBe("number");
    // 分析基准时刻必须独立记录,不能只有 createdAt
    expect(r.analysisAsOf).toBeTruthy();
  }
});

test("**批次拆分同时补图边**,链路不在拆分处断掉", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const stamp = Date.now();
  const src = `E2E-SRC-${stamp}`;

  const res = await page.request.post("/api/traceability/lot-ops", {
    data: {
      kind: "SPLIT",
      sourceLotNos: [src],
      targetLotNos: [`${src}-A`, `${src}-B`],
      quantities: ["3000", "2000"],
      uom: "PCS",
      reason: "E2E 拆分",
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  // 一源两目标 → 必须补出两条边
  expect(body.edgesCreated).toBe(2);
});

test("拆分/合并的形态约束被强制", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const bad = await page.request.post("/api/traceability/lot-ops", {
    data: { kind: "SPLIT", sourceLotNos: ["A", "B"], targetLotNos: ["C"] },
  });
  expect(bad.status()).toBe(422);
  expect(await bad.text()).toContain("拆分只能有一个源批次");

  const badQty = await page.request.post("/api/traceability/lot-ops", {
    data: { kind: "SPLIT", sourceLotNos: ["A"], targetLotNos: ["C", "D"], quantities: ["1"] },
  });
  expect(badQty.status()).toBe(422);
  expect(await badQty.text()).toContain("必须与目标批次个数一致");
});

test("**替代料无批准人时显式警示**,不静默接受", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const stamp = Date.now();

  const noApproval = await page.request.post("/api/traceability/substitutions", {
    data: { workOrderNo: `WO-E2E-${stamp}`, bomMpn: "A-1", actualMpn: "B-1" },
  });
  expect(noApproval.status()).toBe(201);
  const b1 = await noApproval.json();
  expect(b1.warning).toContain("没有批准人");

  const approved = await page.request.post("/api/traceability/substitutions", {
    data: {
      workOrderNo: `WO-E2E-${stamp}-2`,
      bomMpn: "A-1",
      actualMpn: "B-1",
      approvedById: "someone",
      approvalReason: "原厂缺货",
    },
  });
  const b2 = await approved.json();
  expect(b2.warning).toBeNull();
});

test("新增接口受权限约束", async ({ page }) => {
  await login(page, "supplier@demo.qianchuang.cn");
  for (const url of ["/api/traceability/lot-ops", "/api/traceability/substitutions"]) {
    const res = await page.request.post(url, { data: {} });
    expect(res.status()).toBe(403);
  }
});

test("**BOM 版本下拉不得静默截断** —— 超出上限必须明说", async ({ page }) => {
  // 实测踩到:原上限 30,库里 37 个版本时较早的版本在下拉里直接消失且无任何提示,
  // 用户会以为"这个版本不能比价",而不是"列表只显示了最近 30 个"。
  // 静默截断是生产事故的常见来源,故用例守住"要么全都在,要么明确说被截断了"。
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/procurement/rfq");

  const options = page.locator("select[multiple] option");
  const shown = await options.count();
  expect(shown).toBeGreaterThan(0);

  const notice = page.getByText(/下拉仅显示最近/);
  const truncated = (await notice.count()) > 0;
  if (truncated) {
    // 截断时必须说明"这不代表它们不存在",并给出替代路径
    await expect(notice).toContainText("不代表它们不存在");
    await expect(page.getByText(/请从 BOM 台账进入该版本发起/)).toBeVisible();
  }
});
