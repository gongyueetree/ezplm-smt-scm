import { expect, test, type Page } from "@playwright/test";

/**
 * 客户 PR2 反馈第二批(D-3 / D-4 / S-1 / S-2)。
 * 分诊与逐条依据见 docs/customer-feedback/PR2-FEEDBACK-TRIAGE.md。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("D-3 BOM 对比页有真正的输入口:两个下拉选完一次进比对", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/bom/compare");

  // 客户原话:「BOM 对比界面没有输入口」—— 现在必须有可选的控件
  const before = page.getByLabel("变更前");
  const after = page.getByLabel("变更后");
  await expect(before).toBeVisible();
  await expect(after).toBeVisible();

  const opts = await before.locator("option").count();
  test.skip(opts < 3, "库里可比对的 BOM 版本不足两个");

  // 未选满时不得可点 —— 否则点了只会跳到一个无效 URL
  await expect(page.getByRole("button", { name: "开始比对" })).toBeDisabled();

  const values = await before.locator("option").evaluateAll((els) =>
    els.map((e) => (e as HTMLOptionElement).value).filter(Boolean),
  );
  await before.selectOption(values[0]);
  await after.selectOption(values[1]);
  await page.getByRole("button", { name: "开始比对" }).click();

  await expect(page).toHaveURL(/\/bom\/compare\?from=.+&to=.+/);
  await expect(page.getByText("差异明细")).toBeVisible();
});

test("D-3 选了同一个版本必须当场说清,而不是给一张全「未变化」的表", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/bom/compare");

  const before = page.getByLabel("变更前");
  const values = await before.locator("option").evaluateAll((els) =>
    els.map((e) => (e as HTMLOptionElement).value).filter(Boolean),
  );
  test.skip(values.length < 1, "库里没有 BOM 版本");

  await before.selectOption(values[0]);
  await page.getByLabel("变更后").selectOption(values[0]);
  await expect(page.getByText(/同一个版本/)).toBeVisible();
  await expect(page.getByRole("button", { name: "开始比对" })).toBeDisabled();
});

test("D-4 列映射失败时说清缺哪列、认出了什么,且**不再承诺不存在的功能**", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/bom/import");

  // 一份**没有数量列**的 BOM:表头能读,但认不出必需列
  const csv = "位号,厂商,型号,封装\nU1,TI,SN74LVC1G08DBVR,SOT-23-5\n";
  await page.getByLabel("选择文件(可多选)").setInputFiles({
    name: `no-qty-${Date.now().toString(36)}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await page.getByRole("button", { name: "开始导入" }).click();

  const banner = page.locator(".banner.warn[role=alert]");
  await expect(banner).toBeVisible();
  // 必须说清「不是格式不兼容」—— 客户正是因此怀疑格式问题
  await expect(banner).toContainText("不是格式不兼容");
  // 绝不能再出现「请人工指定列映射」:系统根本没有这个入口
  await expect(banner).not.toContainText("人工指定列映射");

  // 后端返回的诊断信息必须真的显示出来
  const help = page.getByTestId("mapping-help");
  await expect(help).toBeVisible();
  await expect(help).toContainText("没认出的列");
  await expect(help).toContainText("数量");
});

test("S-1 报价抬头不再单列 SMT/DIP,人工合计含细分且金额不丢", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/quotes");
  await page.getByRole("button", { name: "创建报价" }).click();
  await expect(page).toHaveURL(/\/quotes\/[^/]+$/);

  const kpis = page.locator(".kpi-grid").first();
  await expect(kpis.locator(".kpi-label", { hasText: "人工合计" })).toBeVisible();
  // 抬头不再有独立的 SMT / DIP 卡片
  await expect(kpis.locator(".kpi-label", { hasText: /^SMT$/ })).toHaveCount(0);
  await expect(kpis.locator(".kpi-label", { hasText: /^DIP$/ })).toHaveCount(0);
  // 但**不是藏起来**:细分金额仍在人工合计下方列出
  await expect(kpis.locator(".kpi", { hasText: "人工合计" })).toContainText("SMT");
  await expect(kpis.locator(".kpi", { hasText: "人工合计" })).toContainText("DIP");
});

test("S-2 导出入口就在「正式导出」卡片里,不必去页面底部找", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/quotes");
  await page.getByRole("button", { name: "创建报价" }).click();
  await expect(page).toHaveURL(/\/quotes\/[^/]+$/);

  const card = page.locator(".card", { hasText: "正式导出" });
  // 草稿态:如实说明不可导出,且不给按钮
  await expect(card).toContainText("不可导出");
  await expect(card.getByRole("link", { name: /导出 XLSX/ })).toHaveCount(0);

  // 全页只能有一处导出入口 —— 两个一模一样的按钮既是噪音也造成歧义
  expect(await page.getByRole("link", { name: /导出 XLSX/ }).count()).toBe(0);
});
