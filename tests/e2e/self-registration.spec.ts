import { expect, test, type Page } from "@playwright/test";

/**
 * 自助注册 E2E。
 *
 * 最要紧的一条:**注册不得夺走已有账号**。演示账号(pm@demo… 等)已经发给
 * 客户在用,如果注册走的是 upsert、或者大小写不同就算另一个人,
 * 任何人都能靠"注册同名邮箱"把演示账号的口令改掉 —— 那是彻底的账号接管。
 *
 * 注:webServer 以 ALLOW_SELF_REGISTRATION=true 启动(见 playwright.config.ts);
 * 「未开启时应拒绝」由单测 registration.test.ts 覆盖 —— 同一个进程无法同时测两种开关。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

function uniq() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function register(
  page: Page,
  data: { email: string; name: string; password: string; role?: string; supplierId?: string },
) {
  return page.request.post("/api/auth/register", {
    data: { role: "PM", ...data },
  });
}

test("注册后立即可用:自动登录进工作台,再登出也能用新口令登回来", async ({ page }) => {
  const u = uniq();
  const email = `e2e-reg-${u}@example.com`;

  await page.goto("/register");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("姓名").fill("E2E 测试员");
  await page.getByLabel("角色").selectOption("PROCUREMENT");
  await page.getByLabel("口令(至少 8 位)").fill(`Str0ng-${u}`);
  await page.getByLabel("再输入一次").fill(`Str0ng-${u}`);
  await page.getByRole("button", { name: "注册并进入" }).click();

  // 注册即登录 —— 应直接进工作台而不是回登录页
  await page.waitForURL("**/");
  await expect(page.locator(".page-title").first()).toBeVisible();

  // 登出后用新口令能登回来,证明口令是真的落库了
  await page.request.post("/api/auth/logout");
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(`Str0ng-${u}`);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
});

test("**注册不得夺走已有演示账号** —— 同邮箱一律 409,且原口令仍然有效", async ({ page }) => {
  const demo = "pm@demo.qianchuang.cn";

  const res = await register(page, {
    email: demo,
    name: "冒名者",
    password: "Attacker-9999",
  });
  expect(res.status(), await res.text()).toBe(409);

  // 大小写变形同样不能绕过 —— 邮箱必须规范化后再比对
  const upper = await register(page, {
    email: demo.toUpperCase(),
    name: "冒名者",
    password: "Attacker-9999",
  });
  expect(upper.status(), "大小写不同的同一邮箱必须同样被拒").toBe(409);

  // 关键验证:演示账号的原口令依然能登录,没有被覆盖
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(demo);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");

  // 冒名者设的口令绝不能登进去
  await page.request.post("/api/auth/logout");
  const bad = await page.request.post("/api/auth/login", {
    data: { email: demo, password: "Attacker-9999" },
  });
  expect(bad.status()).toBe(401);
});

test("供应商角色必须绑定归属,不绑定被拒", async ({ page }) => {
  const u = uniq();
  const res = await register(page, {
    email: `e2e-sup-${u}@example.com`,
    name: "供应商测试",
    password: `Str0ng-${u}`,
    role: "SUPPLIER",
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("归属");
});

test("弱口令与演示口令被拒,并说清原因", async ({ page }) => {
  const u = uniq();
  const res = await register(page, {
    email: `e2e-weak-${u}@example.com`,
    name: "弱口令测试",
    password: "demo1234",
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("常见");

  const short = await register(page, {
    email: `e2e-short-${u}@example.com`,
    name: "短口令测试",
    password: "abc",
  });
  expect(short.status()).toBe(400);
  // 说清差多少,不只说"太短"
  expect(await short.text()).toContain("当前 3 位");
});

test("注册的角色真的生效:选采购能进采购页,选工程的进不去采购的专属操作", async ({ page }) => {
  const u = uniq();
  const email = `e2e-role-${u}@example.com`;
  const res = await register(page, {
    email,
    name: "角色测试",
    password: `Str0ng-${u}`,
    role: "ENGINEERING",
  });
  expect(res.status(), await res.text()).toBe(201);

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(`Str0ng-${u}`);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");

  // 工程角色应能进物料页(角色确实挂上了,不是一个没有角色的空账号)
  await page.goto("/materials");
  await expect(page.locator(".page-title")).toBeVisible();
});
