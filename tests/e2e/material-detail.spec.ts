import { expect, test, type Page } from "@playwright/test";

/**
 * 物料详情 E2E(客户需求:任意页面点开型号即可查看详情 + 每个物料都能查替代料)。
 *
 * 验证点:
 * 1. 列表页的 MPN 是**可点链接**,点击进入 /materials/<mpn>;
 * 2. 详情页有 基本信息 / 规格参数 / 符号与封装在线预览 / 3D 模型 /
 *    分销商价格与库存 / 数据手册与库文件 / 替代料 / 供应与库存 八块;
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

test("物料详情:八个区块齐全,数据来源被诚实标注", async ({ page }) => {
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/materials");
  await page.locator("a.mpn-link").first().click();
  await page.waitForURL("**/materials/**");

  for (const title of [
    "① 基本信息",
    "② 规格参数",
    "③ 原理图符号与 PCB 封装",
    "④ 3D 模型",
    "⑤ 分销商价格与库存",
    "⑥ 数据手册与库文件",
    "⑦ 替代料",
    "⑧ 供应与库存",
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

test("在线预览:原理图符号与 PCB 封装渲染成 SVG,失败时如实报错", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/materials/STM32F103C8T6");

  const card = page.locator(".card", { hasText: "原理图符号与 PCB 封装" });
  await expect(card).toBeVisible();
  // 两栏都必须有结论:要么画出 SVG,要么写明"无法在线渲染:<原因>"
  for (const title of ["原理图符号(.kicad_sym)", "PCB 封装(.kicad_mod)"]) {
    const pane = card.locator("div").filter({ hasText: title }).first();
    await expect(pane).toBeVisible();
  }
  const svgs = card.locator("svg");
  const errors = card.getByText(/无法在线渲染/);
  await expect
    .poll(async () => (await svgs.count()) + (await errors.count()), { timeout: 120_000 })
    .toBeGreaterThan(0);

  // 措辞纪律:必须声明是示意渲染,不得暗示与 KiCad 完全一致
  await expect(card.getByText(/与 KiCad 中的显示可能存在差异/)).toBeVisible();
});

test("在线预览:符号与封装可缩放、拖动、双击复位,且滚轮不带动页面滚动", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/materials/STM32F103C8T6");

  const card = page.locator(".card", { hasText: "原理图符号与 PCB 封装" });
  const viewport = card.locator(".svg-viewport").first();
  await expect(viewport).toBeVisible({ timeout: 120_000 });
  // 关键:变换必须写在 SVG 自己的 <g data-zoom-layer> 上,而不是外层 DOM 的 CSS transform
  // —— 后者会把图层先栅格化再放大,放大后引脚名发糊。
  const zoomLayer = card.locator("[data-zoom-layer]").first();
  await expect(zoomLayer).toHaveCount(1);
  const transform = () => zoomLayer.getAttribute("transform");
  const cssTransform = () =>
    card.locator(".svg-viewport-inner").first().evaluate((el) => getComputedStyle(el).transform);

  // 按钮缩放
  await card.getByRole("button", { name: /^放大/ }).first().click();
  await expect.poll(transform).toContain("scale(1.3)");
  // 外层 DOM 不得出现缩放,否则又回到位图放大
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(await cssTransform());

  await card.getByRole("button", { name: /^缩小/ }).first().click();
  await expect.poll(transform).toContain("scale(1)");

  // 滚轮缩放:必须缩放图纸而**不是**滚动页面
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -400);
  await expect.poll(transform).not.toContain("scale(1)");
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  // 拖动平移
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(transform).not.toContain("translate(0 0)");

  // 双击复位
  await viewport.dblclick();
  await expect.poll(transform).toBe("translate(0 0) scale(1)");
});

test("3D 模型:提供在线预览入口与源文件下载,且说明体积代价", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/materials/STM32F103C8T6");
  const card = page.locator(".card", { hasText: "3D 模型(STEP 在线预览)" });
  await expect(card).toBeVisible();
  if ((await card.getByText("ezPLM 未提供该物料的 3D 模型文件").count()) > 0) {
    test.skip(true, "该型号无 3D 模型,跳过");
  }
  await expect(card.getByRole("button", { name: "加载 3D 模型" })).toBeVisible();
  await expect(card.getByRole("link", { name: "下载 STEP 源文件" })).toBeVisible();
  // 诚实 UI:必须说明需要额外下载多大的东西,而不是默默卡住
  await expect(card.getByText(/7\.6 MB/)).toBeVisible();
});

test("分销商价格与库存:展示数据更新时间且明示非实时", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "procurement@demo.ezplm.cn");
  await page.goto("/materials/STM32F103C8T6");

  const card = page.locator(".card", { hasText: "分销商价格与库存" });
  await expect(card).toBeVisible();
  // 查询完成:要么出报价行,要么明确写"未返回报价"
  await expect
    .poll(
      async () =>
        (await card.locator("tbody tr").filter({ hasText: /DIGIKEY|MOUSER/ }).count()) +
        (await card.getByText(/都未返回该型号的报价|查询失败/).count()),
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0);

  // 诚实 UI:显示数据更新时间 + 明示非实时 + 不做汇率换算
  await expect(card.getByText(/数据更新 \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(card.getByText(/非实时行情/).first()).toBeVisible();
  await expect(card.getByText(/不做汇率换算/)).toBeVisible();
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
  await expect(page.getByText("⑦ 替代料", { exact: false })).toBeVisible();
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
