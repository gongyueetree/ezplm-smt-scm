import { expect, test, type Page } from "@playwright/test";

/**
 * A-1(P0)回归:OPO 回复的**写路径**必须受数据范围约束。
 *
 * 原缺陷:recordOpoReply 只做 tenantWhere,供应商可对本租户任意在途行
 * (含别家供应商的)写 ETA 回复。PR-G 只收口了读路径。
 * 伪造的 ETA 会进 OPO 差异表与催办扫描,驱动错误的采购决策。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("**供应商不能给不属于自己的在途行写回复**(A-1 P0)", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "supplier@demo.qianchuang.cn");

  // 用一个**必然不属于该供应商**的 id;
  // 不存在的 id 与"存在但不属于我"走的是同一条判定分支 —— 这正是要守住的行为
  const forged = "clzzzzzzzzzzzzzzzzzzzzzz";
  const write = await page.request.post(`/api/opo/lines/${forged}/reply`, {
    data: { replyEta: null, replyQty: 10, replyNote: "E2E 越权尝试", replySource: "PORTAL" },
  });
  expect(write.status()).toBe(404);
  // 措辞必须与"不存在"一致 —— 回 403 等于确认该行存在,可被用来枚举别家单号
  expect(await write.text()).toContain("不存在");
});

test("内部角色写回复不受影响(不能因为加了范围就把正常流程挡死)", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  await page.goto("/suppliers/opo");

  // 走真实 UI:表格行内的「记录回复」按钮 —— 它内部调的就是被加固的那个接口。
  // 不用伪造 id,这样才能证明"加了范围之后正常路径还通"。
  const btn = page.getByRole("button", { name: "记录回复" }).first();
  await expect(btn, "OPO 页应有可回复的在途行").toBeVisible({ timeout: 30_000 });

  // 该按钮用两次 window.prompt 收 ETA 与数量;
  // Playwright 默认自动 dismiss 对话框 → 函数直接 return,请求根本不会发出。
  const answers = ["2026-12-31", "100"];
  page.on("dialog", (d) => void d.accept(answers.shift() ?? ""));

  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/reply") && r.request().method() === "POST"),
    btn.click(),
  ]);
  expect(res.status()).toBe(200);
});
