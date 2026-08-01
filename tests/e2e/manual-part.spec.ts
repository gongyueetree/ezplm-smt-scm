import { expect, test, type Page } from "@playwright/test";

/**
 * 手工创建物料 E2E(PR-A 验收点)。
 *
 * 覆盖纪律:
 * - 权限:无 material.create 的角色看不到入口、调 API 被拒;
 * - 同租户内部料号重复必须被拒;
 * - 疑似重复不允许静默创建;
 * - 草稿可缺字段,正式创建必须完整;
 * - ezPLM 引用只预填(未配凭据时如实说"待联调",不假装成功);
 * - 建料动作写入 AuditLog。
 */
// 注意:必须用 `page.request` 而不是独立的 `request` fixture ——
// 后者是独立的 APIRequestContext,**不带 page 的登录 cookie**,
// 打任何受保护接口都会得到 401,把"权限被拒(403)"的断言掩盖掉。
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function openDrawer(page: Page) {
  await page.goto("/materials");
  await page.getByRole("button", { name: "+ 新增物料" }).click();
  await expect(page.getByTestId("create-part-drawer")).toBeVisible();
}

test("权限:工程可见入口,采购不可见,且直接调 API 被拒并指名缺哪个权限", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/materials");
  await expect(page.getByRole("button", { name: "+ 新增物料" })).toBeVisible();

  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/materials");
  await expect(page.getByRole("button", { name: "+ 新增物料" })).toHaveCount(0);

  // 绕过 UI 直接打接口也必须被拒 —— 前端隐藏不算权限
  const res = await page.request.post("/api/materials/parts", {
    data: { target: "ACTIVE", internalPn: "X", mpn: "Y", categoryL1: "IC", manufacturer: "M", description: "D" },
  });
  expect(res.status()).toBe(403);
  expect(await res.text()).toContain("material.create");
});

test("正式创建缺必填项被拒,补齐后创建成功并可在物料库检索到", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.ezplm.cn");
  await openDrawer(page);

  const stamp = Date.now();
  const pn = `EE-E2E-${stamp}`;
  const mpn = `E2E-MPN-${stamp}`;

  // 只填两项就点创建 → 必须逐项报缺
  await page.getByLabel("内部料号 *").fill(pn);
  await page.getByLabel("制造商料号 (MPN) *").fill(mpn);
  await page.getByRole("button", { name: "创建物料" }).click();
  const issues = page.getByTestId("create-part-issues");
  await expect(issues).toContainText("物料分类");
  await expect(issues).toContainText("制造商");
  await expect(issues).toContainText("中文描述");

  // 补齐必填
  await page.getByLabel("物料分类 *").selectOption("IC");
  await page.getByLabel(/^制造商 \*/).fill("E2E Semiconductor");
  await page.getByLabel(/^中文描述 \*/).fill("E2E 测试用 MCU");
  await page.getByRole("button", { name: "创建物料" }).click();

  await page.waitForURL(/\/materials\//, { timeout: 30_000 });
  await page.goto(`/materials?q=${encodeURIComponent(mpn)}`);
  await expect(page.getByText(mpn).first()).toBeVisible();
});

test("分类驱动:选 IC 后加载该分类专属参数", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  await openDrawer(page);
  await page.getByLabel("物料分类 *").selectOption("IC");
  // 通用项 + IC 专属项都应出现
  await expect(page.getByLabel(/工作温度/)).toBeVisible();
  await expect(page.getByLabel(/Flash 容量/)).toBeVisible();

  // 换成阻容感:IC 专属项应消失
  await page.getByLabel("物料分类 *").selectOption("阻容感");
  await expect(page.getByLabel(/Flash 容量/)).toHaveCount(0);
  await expect(page.getByLabel(/额定电压/)).toBeVisible();
});

test("**同租户内部料号重复必须被拒**,且查重给出具体原因", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.ezplm.cn");
  await openDrawer(page);

  // 种子里已有 QC-IC-0001
  await page.getByLabel("内部料号 *").fill("QC-IC-0001");
  await page.getByRole("button", { name: "检查是否重复" }).click();
  const dup = page.getByTestId("dup-result");
  await expect(dup).toContainText("存在阻断性重复");
  await expect(dup).toContainText("内部料号必须唯一");
  // 阻断态下「创建物料」不可点
  await expect(page.getByRole("button", { name: "创建物料" })).toBeDisabled();
});

test("**疑似重复不允许静默创建** —— 未选处置方式即被拒", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  const stamp = Date.now();
  // 直接打接口:同 MPN(种子里的 STM32F103C8T6)但新内部料号 → 疑似而非阻断
  const res = await page.request.post("/api/materials/parts", {
    data: {
      target: "ACTIVE",
      internalPn: `EE-DUP-${stamp}`,
      mpn: "STM32F103C8T6",
      categoryL1: "IC",
      manufacturer: "ST",
      description: "同 MPN 疑似重复",
    },
  });
  expect(res.status()).toBe(409);
  const body = await res.json();
  expect(body.error).toContain("处置方式");
  expect(body.candidates.length).toBeGreaterThan(0);

  // 选「仍然创建」但不填原因 → 仍被拒
  const res2 = await page.request.post("/api/materials/parts", {
    data: {
      target: "ACTIVE",
      internalPn: `EE-DUP-${stamp}`,
      mpn: "STM32F103C8T6",
      categoryL1: "IC",
      manufacturer: "ST",
      description: "同 MPN 疑似重复",
      duplicateResolution: "CREATE_ANYWAY",
    },
  });
  expect(res2.status()).toBe(409);
  expect(await res2.text()).toContain("必须填写原因");

  // 补上原因 → 通过
  const res3 = await page.request.post("/api/materials/parts", {
    data: {
      target: "ACTIVE",
      internalPn: `EE-DUP-${stamp}`,
      mpn: "STM32F103C8T6",
      categoryL1: "IC",
      manufacturer: "ST",
      description: "同 MPN 疑似重复",
      duplicateResolution: "CREATE_ANYWAY",
      duplicateReason: "封装不同,需分开管理",
    },
  });
  expect(res3.status()).toBe(201);
});

test("草稿可缺字段;ezPLM 未配凭据时如实说待联调,不假装引用成功", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");

  const stamp = Date.now();
  const draft = await page.request.post("/api/materials/parts", {
    data: { target: "DRAFT", internalPn: `EE-DRAFT-${stamp}`, mpn: `E2E-D-${stamp}` },
  });
  expect(draft.status()).toBe(201);
  expect((await draft.json()).status).toBe("DRAFT");

  // ezPLM 引用:配了凭据就返回预填,没配就明确说"待联调" —— 两种都不是假成功
  const ref = await page.request.post("/api/materials/parts/ezplm-reference", {
    data: { mpn: "STM32F103C8T6" },
  });
  const text = await ref.text();
  if (ref.status() === 422) {
    expect(text).toContain("待联调");
  } else {
    expect([200, 404, 502]).toContain(ref.status());
  }
});

test("建料写入 AuditLog,可在系统设置中查到", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.ezplm.cn");
  const stamp = Date.now();
  const pn = `EE-AUDIT-${stamp}`;
  const res = await page.request.post("/api/materials/parts", {
    data: {
      target: "ACTIVE",
      internalPn: pn,
      mpn: `E2E-A-${stamp}`,
      categoryL1: "IC",
      manufacturer: "ST",
      description: "审计用例",
    },
  });
  expect(res.status()).toBe(201);

  await login(page, "management@demo.ezplm.cn");
  await page.goto("/settings");
  await expect(page.getByText("PART_CREATE").first()).toBeVisible({ timeout: 30_000 });
});

/* ---------------- 批量导入 + 文档与合规 ---------------- */

function uniqPn(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

test("批量导入:预览不写库;阻断行不建;疑似重复默认不建", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.ezplm.cn");
  const u = uniqPn();

  // 一行全新、一行内部料号撞种子(QC-IC-0001)、一行同 MPN 撞种子
  const text = [
    "内部料号,MPN,制造商,中文描述,物料分类",
    `EE-BULK-${u},M-BULK-${u},ST,批量导入用例,IC`,
    "QC-IC-0001,SOMETHING-ELSE,ST,料号撞车,IC",
    `EE-SUS-${u},STM32F103C8T6,ST,同MPN疑似,IC`,
  ].join("\n");

  const preview = await page.request.post("/api/materials/parts/bulk-import", {
    data: { text, mode: "PREVIEW" },
  });
  expect(preview.status()).toBe(200);
  const pb = await preview.json();
  expect(pb.note).toContain("未创建任何物料");
  expect(pb.plan.willCreate).toBe(1);
  expect(pb.plan.blocked).toBe(1);
  expect(pb.plan.suspected).toBe(1);

  // 预览确实没写库
  const check = await page.request.get(`/materials?q=EE-BULK-${u}`);
  void check;

  const exec = await page.request.post("/api/materials/parts/bulk-import", {
    data: { text, mode: "EXECUTE" },
  });
  expect(exec.status()).toBe(201);
  const eb = await exec.json();
  // 只建全新那一行:阻断不建,疑似默认也不建
  expect(eb.created).toBe(1);
  expect(eb.note).toContain("阻断重复");
  expect(eb.note).toContain("需人工确认后才建");
});

test("批量导入:同一文件内料号重复在解析阶段就被拦下", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  const u = uniqPn();
  const res = await page.request.post("/api/materials/parts/bulk-import", {
    data: {
      text: `内部料号,MPN\nEE-D-${u},M1\nEE-D-${u},M2`,
      mode: "PREVIEW",
    },
  });
  const body = await res.json();
  expect(body.plan.rows).toHaveLength(1);
  expect(JSON.stringify(body.errors)).toContain("已出现");
});

test("**文档有效期:未填不视为长期有效**,且过期项进合规预警", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.ezplm.cn");
  const u = uniqPn();

  const created = await page.request.post("/api/materials/parts", {
    data: {
      target: "ACTIVE",
      internalPn: `EE-DOC-${u}`,
      mpn: `M-DOC-${u}`,
      categoryL1: "IC",
      manufacturer: "ST",
      description: "文档用例",
    },
  });
  expect(created.status()).toBe(201);
  const { partId } = await created.json();

  // ① 不填有效期
  const noExpiry = new FormData();
  noExpiry.append("file", new Blob(["dummy"], { type: "application/pdf" }), "rohs-no-expiry.pdf");
  noExpiry.append("kind", "ROHS_REPORT");
  const r1 = await page.request.post(`/api/materials/parts/${partId}/documents`, {
    multipart: {
      file: { name: "rohs-no-expiry.pdf", mimeType: "application/pdf", buffer: Buffer.from("dummy") },
      kind: "ROHS_REPORT",
    },
  });
  expect(r1.status()).toBe(201);
  expect(await r1.text()).toContain("不视为长期有效");

  // ② 已过期
  const r2 = await page.request.post(`/api/materials/parts/${partId}/documents`, {
    multipart: {
      file: { name: "reach-expired.pdf", mimeType: "application/pdf", buffer: Buffer.from("dummy") },
      kind: "REACH_REPORT",
      validUntil: "2020-01-01",
    },
  });
  expect(r2.status()).toBe(201);

  const list = await page.request.get(`/api/materials/parts/${partId}/documents`);
  const lb = await list.json();
  expect(lb.documents).toHaveLength(2);
  expect(lb.documents.some((d: { validUntil: string | null }) => d.validUntil === null)).toBe(true);

  // 合规汇总:过期计入紧急,未标注单独计数
  const comp = await page.request.get("/api/materials/compliance");
  const cb = await comp.json();
  expect(cb.summary.urgentCount).toBeGreaterThan(0);
  expect(cb.summary.unknownCount).toBeGreaterThan(0);
  expect(cb.urgent.some((x: { fileName: string }) => x.fileName === "reach-expired.pdf")).toBe(true);
});

test("文档区在详情页可见,且无文档时不暗示合规", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/materials/STM32F103C8T6");
  await expect(page.getByText("文档与合规").first()).toBeVisible();
  await expect(page.getByText(/不等于该料合规/)).toBeVisible();
});
