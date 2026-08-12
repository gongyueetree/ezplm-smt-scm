import { expect, test, type Page } from "@playwright/test";

/**
 * E2 / 客户 Q10:「**实现功能一致是最重要的**,功能不能不同。
 * 需要增加「功能一致、但封装有细微差别」的筛选条件」。
 *
 * 用例守两条:
 * ① 四种筛选各自选得出对的东西,**「未知」一律不算命中**;
 * ② 排序以**功能一致优先** —— 封装一样但功能只是部分一致的,排在后面。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

/**
 * 用例前缀。**必须带随机位** —— 只用 Date.now() 时,并行跑的两条用例
 * 可能落在同一毫秒,前缀相同就会互相搜到对方的数据,
 * 表现为断言里冒出一条根本不属于本用例的料号。
 */
function uniqueTag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/** 建一颗本用例专属的料,返回 partId */
async function createPart(page: Page, tag: string, suffix: string): Promise<string> {
  const res = await page.request.post("/api/materials/parts", {
    data: {
      target: "ACTIVE",
      internalPn: `EE-${tag}-${suffix}`,
      mpn: `MPN-${tag}-${suffix}`,
      categoryL1: "IC",
      manufacturer: "E2-TEST",
      description: `E2 替代料用例 ${suffix}`,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).partId as string;
}

async function link(
  page: Page,
  basePartId: string,
  alternatePartId: string,
  functional: string,
  pkg: string,
  pin: string,
) {
  const res = await page.request.post("/api/materials/alternates", {
    data: {
      basePartId,
      alternatePartId,
      functionalEquivalence: functional,
      packageCompatibility: pkg,
      pinCompatibility: pin,
      reason: "E2 用例",
      evidenceSource: "MANUAL",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

test("四种筛选各自选得对,且「未知」不算命中", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const tag = uniqueTag();

  const base = await createPart(page, tag, "BASE");
  const same = await createPart(page, tag, "SAME");     // 功能一致 + 封装一致 + PtP
  const minor = await createPart(page, tag, "MINOR");   // 功能一致 + 封装细微差别
  const notPin = await createPart(page, tag, "NOTPIN"); // 功能一致 + 非 PtP
  const unk = await createPart(page, tag, "UNK");       // 功能未知 + 封装一致 + PtP

  await link(page, base, same, "EXACT", "EXACT", "PIN_TO_PIN");
  await link(page, base, minor, "EXACT", "MINOR_VARIATION", "PIN_TO_PIN");
  await link(page, base, notPin, "EQUIVALENT", "EXACT", "REQUIRES_REVIEW");
  await link(page, base, unk, "UNKNOWN", "EXACT", "PIN_TO_PIN");

  const q = (preset: string) =>
    page.request
      .get(`/api/materials/alternates?preset=${preset}&q=EE-${tag}-`)
      .then((r) => r.json())
      .then((b) => (b.items as { item: { altPn: string } }[]).map((x) => x.item.altPn));

  /*
   * 「功能一致 + 封装一致」这一档**不看引脚** —— 引脚是第三个维度,
   * 单独有一档。所以 NOTPIN(功能一致、封装一致、引脚待确认)也在这里,
   * 而且排在 SAME 之后(SAME 三项全绿,分更高)。
   */
  expect(await q("FUNC_SAME_PKG_SAME")).toEqual([`EE-${tag}-SAME`, `EE-${tag}-NOTPIN`]);
  expect(await q("FUNC_SAME_PKG_MINOR")).toEqual([`EE-${tag}-MINOR`]);
  expect(await q("FUNC_SAME_NOT_PIN")).toEqual([`EE-${tag}-NOTPIN`]);
  // 只看完全 Pin-to-Pin:UNK 虽然封装一致 + PtP,但功能未知 —— 仍会出现在这一档
  // (这一档不看功能,是"我就要直接换"的视角),所以断言它包含 SAME 且顺序上 SAME 在前
  const ptp = await q("PIN_TO_PIN_ONLY");
  expect(ptp).toContain(`EE-${tag}-SAME`);
  expect(ptp.indexOf(`EE-${tag}-SAME`)).toBeLessThan(ptp.indexOf(`EE-${tag}-UNK`));

  // 「未知」不该出现在任何以"功能一致"为前提的档里
  for (const p of ["FUNC_SAME_PKG_SAME", "FUNC_SAME_PKG_MINOR", "FUNC_SAME_NOT_PIN"]) {
    expect(await q(p), `${p} 不应包含功能未知的条目`).not.toContain(`EE-${tag}-UNK`);
  }
});

test("**排序以功能一致优先** —— 封装一致但功能只是部分一致的排在后面", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const tag = uniqueTag();

  const base = await createPart(page, tag, "B2");
  const funcSamePkgDiff = await createPart(page, tag, "FUNCOK");
  const pkgSameFuncPartial = await createPart(page, tag, "PKGOK");

  // 先插入"封装完全一致但功能只是部分一致"的,再插入"功能一致但封装不同"的
  await link(page, base, pkgSameFuncPartial, "PARTIAL", "EXACT", "PIN_TO_PIN");
  await link(page, base, funcSamePkgDiff, "EXACT", "DIFFERENT", "NOT_COMPATIBLE");

  const res = await page.request.get(`/api/materials/alternates?q=EE-${tag}-`);
  const items = (await res.json()).items as { item: { altPn: string } }[];
  const order = items.map((x) => x.item.altPn);
  expect(order.indexOf(`EE-${tag}-FUNCOK`)).toBeLessThan(order.indexOf(`EE-${tag}-PKGOK`));
});

test("页面上四种筛选可见,并写明「未知不算命中」", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/materials/alternates");
  const panel = page.getByTestId("compat-panel");
  await expect(panel).toBeVisible();
  for (const p of [
    "FUNC_SAME_PKG_SAME",
    "FUNC_SAME_PKG_MINOR",
    "FUNC_SAME_NOT_PIN",
    "PIN_TO_PIN_ONLY",
  ]) {
    await expect(panel.getByTestId(`preset-${p}`)).toBeVisible();
  }
  await expect(page.getByTestId("preset-desc")).toContainText("功能一致优先");
  await expect(page.getByTestId("preset-desc")).toContainText("不知道不等于符合");
});
