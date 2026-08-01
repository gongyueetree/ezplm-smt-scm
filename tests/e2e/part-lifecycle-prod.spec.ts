import { expect, test, type Page } from "@playwright/test";

/**
 * PR-F 生产加固 E2E:物料生命周期 / 编码规则 / 合规声明。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("编码规则:可配置且**能预览下一个号**", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  const u = Date.now().toString(36).toUpperCase();

  const res = await page.request.post("/api/settings/part-code-rules", {
    data: { name: `E2E规则-${u}`, prefix: "E2E", sequenceWidth: 4, includeCategory: true },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(Array.isArray(body.preview)).toBe(true);
  expect(body.preview).toHaveLength(3);
  // 补零 + 连续
  expect(body.preview[0]).toMatch(/^E2E-GEN-\d{4}$/);

  const list = await page.request.get("/api/settings/part-code-rules?categoryL1=IC");
  const lb = await list.json();
  const mine = lb.rules.find((r: { name: string }) => r.name === `E2E规则-${u}`);
  expect(mine.preview[0]).toContain("E2E-IC-");
});

test("合规声明:**新建后不生效,必须审核**", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  const u = Date.now().toString(36).toUpperCase();

  // 先建一颗物料
  const part = await page.request.post("/api/materials/parts", {
    data: {
      target: "ACTIVE",
      internalPn: `EE-CMP-${u}`,
      mpn: `M-CMP-${u}`,
      categoryL1: "IC",
      manufacturer: "ST",
      description: "合规用例",
    },
  });
  expect(part.status()).toBe(201);
  const partId = (await part.json()).partId;
  expect(partId, "建料接口应返回 partId").toBeTruthy();

  const decl = await page.request.post(`/api/materials/parts/${partId}/compliance`, {
    data: { scheme: "ROHS", verdict: "COMPLIANT", validUntil: "2030-01-01" },
  });
  expect(decl.status()).toBe(201);
  const db = await decl.json();
  expect(db.state).toBe("DRAFT");
  expect(db.note).toContain("尚未审核");

  // 生效结论必须是 UNKNOWN 而不是 COMPLIANT
  const got = await page.request.get(`/api/materials/parts/${partId}/compliance`);
  const gb = await got.json();
  const rohs = gb.summary.find((s: { scheme: string }) => s.scheme === "ROHS");
  expect(rohs.verdict).toBe("UNKNOWN");
  expect(rohs.reason).toContain("未审核");
});

test("**没有声明时如实返回未知**,三个体系都要列出", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  const u = Date.now().toString(36).toUpperCase();
  const part = await page.request.post("/api/materials/parts", {
    data: {
      target: "ACTIVE",
      internalPn: `EE-NC-${u}`,
      mpn: `M-NC-${u}`,
      categoryL1: "IC",
      manufacturer: "ST",
      description: "无声明",
    },
  });
  // 注意:接口返回字段是 partId 而不是 id。
  // 用错字段会得到 undefined,而 GET 查 undefined 只会返回空 —— 用例会**因为错误的原因通过**。
  const partId = (await part.json()).partId;
  expect(partId, "建料接口应返回 partId").toBeTruthy();

  const got = await page.request.get(`/api/materials/parts/${partId}/compliance`);
  const gb = await got.json();
  expect(gb.summary.map((s: { scheme: string }) => s.scheme)).toEqual(["ROHS", "REACH", "COC"]);
  for (const s of gb.summary) {
    expect(s.verdict).toBe("UNKNOWN");
    expect(s.reason).toContain("尚无");
  }
});

test("编码规则维护受权限约束", async ({ page }) => {
  await login(page, "supplier@demo.ezplm.cn");
  const res = await page.request.post("/api/settings/part-code-rules", {
    data: { name: "X", prefix: "X" },
  });
  expect(res.status()).toBe(403);
});
