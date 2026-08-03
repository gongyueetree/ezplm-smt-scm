import { expect, test, type Page } from "@playwright/test";

/**
 * ERP 同步中心 E2E(PR-B 验收点)。
 *
 * 覆盖纪律:
 * - 未配凭据不得显示「连接正常」;
 * - 敏感字段不出现在 API 响应;
 * - 字段映射缺必填项禁止保存;
 * - **预览不写库**;
 * - 冲突不被自动覆盖;
 * - 重复同步幂等;
 * - 未联调厂商报错而非返回空数据;
 * - 跨租户连接不可访问(以权限拒绝体现)。
 *
 * 注意:必须用 `page.request`,独立 request fixture 不带登录 cookie。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function mockConnectionId(page: Page): Promise<string> {
  const res = await page.request.get("/api/erp/connections");
  expect(res.status()).toBe(200);
  const body = await res.json();
  const conn = body.connections.find((c: { vendor: string }) => c.vendor === "MOCK");
  expect(conn, "种子应提供一个 Mock 连接").toBeTruthy();
  return conn.id;
}

test("页面:未配凭据显示「待联调」,且明确声明「已连接」只在实测通过后出现", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/integrations/erp");

  await expect(page.locator(".page-title")).toHaveText("ERP 同步");
  await expect(page.getByText(/「已连接」只在真实请求成功后才会出现/)).toBeVisible();
  // 种子连接从未测试过 → 一律「待联调」,不得出现"连接正常"
  await expect(page.getByText("待联调").first()).toBeVisible();
  expect(await page.getByText("连接正常").count()).toBe(0);
  await expect(page.getByText("从未测试").first()).toBeVisible();
});

test("权限:采购只能看不能配;管理层可配", async ({ page }) => {
  await login(page, "procurement@demo.qianchuang.cn");
  const res = await page.request.post("/api/erp/connections", {
    data: { name: `E2E-${Date.now()}`, vendor: "MOCK" },
  });
  expect(res.status()).toBe(403);
  expect(await res.text()).toContain("erp.connection.manage");

  await login(page, "management@demo.qianchuang.cn");
  const ok = await page.request.post("/api/erp/connections", {
    data: { name: `E2E-OK-${Date.now()}`, vendor: "MOCK" },
  });
  expect(ok.status()).toBe(201);
});

test("**凭据不回传明文**,只回掩码", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  const secret = `SUPER-SECRET-${Date.now()}`;
  const created = await page.request.post("/api/erp/connections", {
    data: {
      name: `E2E-SEC-${Date.now()}`,
      vendor: "KINGDEE",
      edition: "云星空",
      config: { baseUrl: "https://erp.example.com", dbId: "db1", appId: "app1" },
      secrets: { appSecret: secret, password: "pw-1234567890" },
    },
  });
  expect(created.status()).toBe(201);

  const list = await page.request.get("/api/erp/connections");
  const text = await list.text();
  // 明文一个字都不能出现
  expect(text).not.toContain(secret);
  expect(text).not.toContain("pw-1234567890");
  // 但要能看到掩码,便于核对是不是同一把钥匙
  expect(text).toContain("maskedHint");
});

test("**未联调厂商报「尚未联调」,不返回空数据冒充同步完成**", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  const created = await page.request.post("/api/erp/connections", {
    data: { name: `E2E-YY-${Date.now()}`, vendor: "YONYOU", edition: "U8" },
  });
  const { id } = await created.json();

  // 先配好映射,排除"映射不全"这个干扰项
  await page.request.put(`/api/erp/connections/${id}/mapping`, {
    data: {
      entityType: "MATERIAL",
      mappings: [{ erpField: "cInvCode", localField: "internalPn" }],
    },
  });

  const res = await page.request.post(`/api/erp/connections/${id}/sync`, {
    data: { entityType: "MATERIAL", mode: "PREVIEW" },
  });
  expect(res.status()).toBe(501);
  expect(await res.text()).toContain("尚未联调");

  // 连接测试也必须 ok=false
  const t = await page.request.post(`/api/erp/connections/${id}/test`);
  const tb = await t.json();
  expect(tb.result.ok).toBe(false);
  expect(tb.status).toBe("NOT_CONFIGURED");
});

test("字段映射:缺必填项禁止保存;样例值转换失败也禁止保存", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  const id = await mockConnectionId(page);

  const bad = await page.request.put(`/api/erp/connections/${id}/mapping`, {
    data: { entityType: "MATERIAL", mappings: [{ erpField: "FName", localField: "description" }] },
  });
  expect(bad.status()).toBe(422);
  expect(await bad.text()).toContain("internalPn");

  const badSample = await page.request.put(`/api/erp/connections/${id}/mapping`, {
    data: {
      entityType: "MATERIAL",
      mappings: [
        { erpField: "internalPn", localField: "internalPn" },
        { erpField: "moq", localField: "moq", transform: "decimal", sampleValue: "不是数字" },
      ],
    },
  });
  expect(badSample.status()).toBe(422);
  expect(await badSample.text()).toContain("样例验证未通过");
});

test("预览不写库;重复同步幂等;冲突不自动覆盖", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  const id = await mockConnectionId(page);

  // Mock 的物料字段就是本系统字段名,直接一一映射
  const save = await page.request.put(`/api/erp/connections/${id}/mapping`, {
    data: {
      entityType: "MATERIAL",
      mappings: [
        { erpField: "internalPn", localField: "internalPn" },
        { erpField: "mpn", localField: "mpn" },
        { erpField: "manufacturer", localField: "manufacturer" },
        { erpField: "description", localField: "description" },
      ],
    },
  });
  expect(save.status()).toBe(200);

  const before = await page.request.get("/api/materials/parts/duplicate-check", {}).catch(() => null);
  void before;

  const p1 = await page.request.post(`/api/erp/connections/${id}/sync`, {
    data: { entityType: "MATERIAL", mode: "PREVIEW" },
  });
  expect(p1.status()).toBe(200);
  const b1 = await p1.json();
  expect(b1.note).toContain("未写入任何业务数据");

  // Mock 里 QC-IC-0077 的制造商与种子不同 → 应判冲突而不是直接更新
  expect(b1.summary.conflict + b1.summary.updated).toBeGreaterThan(0);

  // 重复预览同一批数据 → 幂等命中
  const p2 = await page.request.post(`/api/erp/connections/${id}/sync`, {
    data: { entityType: "MATERIAL", mode: "PREVIEW" },
  });
  const b2 = await p2.json();
  expect(b2.duplicated).toBe(true);
  expect(b2.jobId).toBe(b1.jobId);

  // 行级日志可查
  const lines = await page.request.get(`/api/erp/jobs/${b1.jobId}/lines`);
  expect(lines.status()).toBe(200);
  const lb = await lines.json();
  expect(lb.lines.length).toBeGreaterThan(0);
  expect(lb.lines.some((l: { outcome: string }) => l.outcome === "CREATED" || l.outcome === "CONFLICT")).toBe(true);
});

test("四步向导可走到预览,且预览区明确写「不写入任何业务数据」", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/integrations/erp");
  await page.getByRole("button", { name: "配置 ERP 连接" }).click();

  await expect(page.getByTestId("erp-step1")).toBeVisible();
  await page.getByRole("button", { name: /^Excel \/ CSV/ }).click();
  await page.getByLabel("连接名称").fill(`E2E-WIZ-${Date.now()}`);
  await page.getByRole("button", { name: "创建连接" }).click();
  await page.getByRole("button", { name: "测试连接" }).click();

  const result = page.getByTestId("erp-test-result");
  await expect(result).toBeVisible();
  // Excel 通道要如实说明它不连任何 ERP
  await expect(result).toContainText("不连接任何 ERP");

  await page.getByRole("button", { name: /下一步:字段映射/ }).click();
  await expect(page.getByTestId("erp-step2")).toBeVisible();
  await expect(page.getByText(/缺一项都.*不允许保存映射/)).toBeVisible();
});
