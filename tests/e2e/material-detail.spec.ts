import { expect, test, type Page } from "@playwright/test";

/**
 * 物料详情 E2E(客户需求:任意页面点开型号即可查看详情 + 每个物料都能查替代料)。
 *
 * 验证点:
 * 1. 列表页的 MPN 是**可点链接**,点击进入 /materials/<mpn>;
 * 2. 详情页有 基本信息 / 规格参数 / 数据手册与库文件 / 替代料 / 供应与库存 五块;
 * 3. 数据来源被**诚实标注**(ezPLM 实时接口 / 本地缓存 / 示例数据),不假装实时;
 * 4. 未收录的型号给出明确说明而**不是 500 或空白页**;
 * 5. 替代料区块对**任意**物料都存在(哪怕为空,也说明"暂无",不隐藏能力)。
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("物料列表:MPN 可点击进入详情页", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/materials");
  await expect(page.locator(".page-title")).toHaveText("物料查询");

  const firstMpn = page.locator("a.mpn-link").first();
  await expect(firstMpn).toBeVisible();
  const mpn = (await firstMpn.innerText()).trim();

  await firstMpn.click();
  await page.waitForURL("**/materials/**");
  await expect(page.locator(".page-title")).toHaveText(mpn);
});

test("物料详情:五个区块齐全,数据来源被诚实标注", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/materials");
  await page.locator("a.mpn-link").first().click();
  await page.waitForURL("**/materials/**");

  for (const title of [
    "① 基本信息",
    "② 规格参数",
    "③ 数据手册与库文件",
    "④ 替代料",
    "⑤ 供应与库存",
  ]) {
    await expect(page.getByText(title, { exact: false }).first()).toBeVisible();
  }

  // 数据来源标注三选一,不得出现"实时同步"之类的虚假完成态
  await expect(
    page.getByText(/ezPLM 实时接口|本地缓存|示例数据/).first(),
  ).toBeVisible();
  await expect(page.getByText("数据获取时间").first()).toBeVisible();

  // 替代料区块必须说明能力边界(ezPLM API 不提供替代料)
  await expect(page.getByText(/不提供替代料能力/)).toBeVisible();
});

test("替代料:任意物料都能检索同系列候选,且标注为「候选·待人工判定」", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/materials/STM32F103C8T6");

  await page.getByRole("button", { name: "检索同系列候选" }).click();
  // 结果区:要么给出候选表,要么如实说明为什么没查(不得静默无反应)
  await expect(page.getByText(/检索关键字|无法推导出可靠的系列前缀|检索降级/)).toBeVisible({
    timeout: 60_000,
  });

  const rows = page.locator("table.tbl tbody tr", { hasText: "候选 · 待人工判定" });
  if ((await rows.count()) > 0) {
    // 候选必须被标注为待人工判定,绝不写成"可替代"
    await expect(rows.first()).toContainText("候选 · 待人工判定");
    // 措辞纪律:必须写明这不是已成立的替代关系,须人工判定
    await expect(page.getByText(/须由工程按参数、封装、合规逐项人工判定/)).toBeVisible();
  }
});

test("未收录型号:给出明确说明而非报错页", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/materials/NO-SUCH-MPN-E2E-XYZ");
  await expect(page.locator(".page-title")).toHaveText("NO-SUCH-MPN-E2E-XYZ");
  await expect(page.getByText(/未在 ezPLM 与本地缓存中找到/)).toBeVisible();
  // 能力仍在:替代料区块照常展示
  await expect(page.getByText("④ 替代料", { exact: false })).toBeVisible();
});

test("缺料分析页的 MPN 同样可点开详情", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/shortage");
  const link = page.locator("a.mpn-link").first();
  if ((await link.count()) === 0) {
    test.skip(true, "当前库中无缺料行,跳过(列表为空不代表链接缺失)");
  }
  const mpn = (await link.innerText()).trim();
  await link.click();
  await page.waitForURL("**/materials/**");
  await expect(page.locator(".page-title")).toHaveText(mpn);
});
