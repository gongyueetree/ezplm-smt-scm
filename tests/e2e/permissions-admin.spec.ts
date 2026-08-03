import { expect, test, type Page } from "@playwright/test";

/**
 * 权限配置页 E2E。
 *
 * ⚠ 本文件会**改动共享的权限状态**,并行跑时可能影响别的用例。
 * 因此实验对象一律选 **PM** ——
 * `manual-part.spec.ts` 断言「采购不能建料」、「工程能建料」,
 * 拿这两个角色做实验会与之直接冲突(实测遇到过偶发失败);
 * 而没有任何用例依赖 PM 的 material.create,拿它做实验最安全。
 *
 * 覆盖:
 * - 只有具备 settings.permissions.manage 的人能进;
 * - 租户级授予立刻改变目标角色的实际能力(端到端验证,不是只看 UI 打勾);
 * - 用户级回收覆盖角色默认;
 * - **不允许回收自己的权限管理权**(否则谁都进不来)。
 */
/**
 * **本文件必须串行**。
 * 这些用例会改动**全局共享的权限状态**,并行跑时会互相打架 ——
 * 实测:一条用例在角色级撤销 PM 的 material.create 后断言 403,
 * 而另一条同时在用户级授予了同一权限,于是撤销那条看到 201。
 * 这不是产品缺陷,是用例设计问题:改全局状态的测试不能并发。
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function userId(page: Page, email: string): Promise<string> {
  const res = await page.request.get("/api/settings/permissions");
  const body = await res.json();
  const u = body.users.find((x: { email: string }) => x.email === email);
  expect(u, `应能找到用户 ${email}`).toBeTruthy();
  return u.id;
}

test("只有管理层能进权限配置页", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/settings/permissions");
  await expect(page.getByText("settings.permissions.manage")).toBeVisible();
  await expect(page.getByText(/缺少/)).toBeVisible();

  const denied = await page.request.get("/api/settings/permissions");
  expect(denied.status()).toBe(403);

  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/permissions");
  await expect(page.getByText("租户级角色授予")).toBeVisible();
});

test("**租户级授予真的改变能力** —— 授予后 PM 能建料,撤销后又不能", async ({ page }) => {
  test.setTimeout(180_000);
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

  // 基线:PM 不能建料
  await login(page, "pm@demo.qianchuang.cn");
  const before = await page.request.post("/api/materials/parts", {
    data: { target: "ACTIVE", internalPn: `EE-P-${u}`, mpn: `M-P-${u}`, categoryL1: "IC", manufacturer: "ST", description: "权限用例" },
  });
  expect(before.status()).toBe(403);

  // 管理层授予
  await login(page, "management@demo.qianchuang.cn");
  const grant = await page.request.post("/api/settings/permissions", {
    data: { kind: "ROLE_GRANT", role: "PM", permission: "material.create", enabled: true },
  });
  expect(grant.status()).toBe(200);

  // PM 现在能建了
  await login(page, "pm@demo.qianchuang.cn");
  const after = await page.request.post("/api/materials/parts", {
    data: { target: "ACTIVE", internalPn: `EE-P-${u}`, mpn: `M-P-${u}`, categoryL1: "IC", manufacturer: "ST", description: "权限用例" },
  });
  expect(after.status()).toBe(201);

  // 撤销后又不能
  await login(page, "management@demo.qianchuang.cn");
  await page.request.post("/api/settings/permissions", {
    data: { kind: "ROLE_GRANT", role: "PM", permission: "material.create", enabled: false },
  });
  await login(page, "pm@demo.qianchuang.cn");
  const revoked = await page.request.post("/api/materials/parts", {
    data: { target: "ACTIVE", internalPn: `EE-P2-${u}`, mpn: `M-P2-${u}`, categoryL1: "IC", manufacturer: "ST", description: "权限用例" },
  });
  expect(revoked.status()).toBe(403);
});

test("用户级授予/回收覆盖角色默认,且来源推演能说清是谁决定的", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.qianchuang.cn");
  const pmId = await userId(page, "pm@demo.qianchuang.cn");
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

  // ① 用户级授予:PM 默认没有 material.create
  const grant = await page.request.post("/api/settings/permissions", {
    data: { kind: "USER_OVERRIDE", userId: pmId, permission: "material.create", mode: "GRANT", reason: "E2E" },
  });
  expect(grant.status()).toBe(200);

  let explain = await page.request.get(`/api/settings/permissions?explain=${pmId}`);
  let item = (await explain.json()).explanations.find(
    (x: { permission: string }) => x.permission === "material.create",
  );
  expect(item.granted).toBe(true);
  expect(item.decidedBy).toBe("USER_GRANT");

  await login(page, "pm@demo.qianchuang.cn");
  const created = await page.request.post("/api/materials/parts", {
    data: { target: "ACTIVE", internalPn: `EE-U-${u}`, mpn: `M-U-${u}`, categoryL1: "IC", manufacturer: "ST", description: "x" },
  });
  expect(created.status()).toBe(201);

  // ② 改成回收:即便刚授予过,回收也要立刻生效
  await login(page, "management@demo.qianchuang.cn");
  await page.request.post("/api/settings/permissions", {
    data: { kind: "USER_OVERRIDE", userId: pmId, permission: "material.create", mode: "REVOKE" },
  });
  explain = await page.request.get(`/api/settings/permissions?explain=${pmId}`);
  item = (await explain.json()).explanations.find(
    (x: { permission: string }) => x.permission === "material.create",
  );
  expect(item.granted).toBe(false);
  expect(item.decidedBy).toBe("USER_REVOKE");

  await login(page, "pm@demo.qianchuang.cn");
  const denied = await page.request.post("/api/materials/parts", {
    data: { target: "ACTIVE", internalPn: `EE-U2-${u}`, mpn: `M-U2-${u}`, categoryL1: "IC", manufacturer: "ST", description: "x" },
  });
  expect(denied.status()).toBe(403);

  // ③ 清除覆盖 → 回到角色默认(PM 本来就没有)
  await login(page, "management@demo.qianchuang.cn");
  await page.request.post("/api/settings/permissions", {
    data: { kind: "USER_OVERRIDE", userId: pmId, permission: "material.create", mode: "CLEAR" },
  });
  explain = await page.request.get(`/api/settings/permissions?explain=${pmId}`);
  item = (await explain.json()).explanations.find(
    (x: { permission: string }) => x.permission === "material.create",
  );
  expect(item.granted).toBe(false);
  expect(item.decidedBy).toBe("NONE");
});

test("**不允许回收自己的权限管理权** —— 否则谁都进不来", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  const selfId = await userId(page, "management@demo.qianchuang.cn");

  const res = await page.request.post("/api/settings/permissions", {
    data: {
      kind: "USER_OVERRIDE",
      userId: selfId,
      permission: "settings.permissions.manage",
      mode: "REVOKE",
    },
  });
  expect(res.status()).toBe(422);
  expect(await res.text()).toContain("将无人可进入本页面");
});

test("角色默认权限在页面上只读展示,不提供勾选框", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings/permissions");
  // 工程的 material.create 是角色默认 → 显示「默认」徽标而不是 checkbox
  const row = page.locator("tbody tr").filter({ hasText: "material.create" }).first();
  await expect(row.getByText("默认").first()).toBeVisible();
  await expect(page.getByText(/角色默认权限来自代码,页面只读/)).toBeVisible();
});
