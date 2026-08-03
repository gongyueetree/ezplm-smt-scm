import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * 人工指定型号 + 替代料查询 E2E。
 *
 * 背景:此前匹配确认页只有「采纳候选」与「标记无匹配」——
 * 一行没有候选时,人**没有任何地方可以填型号**,流程就卡死在那里。
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";
/**
 * 用**专属夹具**而不是公共的 demo-bom.csv。
 * 导入是幂等的(同文件同解析结果复用同一版本),本用例又会**修改** BOM 行,
 * 共用夹具就会把别的用例依赖的数据改掉 —— 实测把采购比价用例的料号改没了。
 */
const BOM_FIXTURE = path.join(__dirname, "fixtures", "manual-assign-bom.csv");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("匹配确认页可人工指定型号,并写回 BOM 行", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.qianchuang.cn");

  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles(BOM_FIXTURE);
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: /进入匹配确认/ }).first().click();
  await page.waitForURL("**/bom/version/**");

  // 人工指定入口必须存在(不能只有"采纳候选/标记无匹配")
  const input = page.getByPlaceholder("人工指定型号").first();
  await expect(input).toBeVisible();

  await input.fill("MANUAL-TEST-MPN-001");
  await page.getByRole("button", { name: "确认指定" }).first().click();

  // 决定被记录,且**型号写回了 BOM 行**(否则后续比价读不到)
  await expect(page.getByText("已人工指定").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "MANUAL-TEST-MPN-001" }).first()).toBeVisible();
});

test("替代料查询:两段式流程,四维评分,Pin-to-Pin 未验证引脚必须警示", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/materials/alternates");

  await expect(page.locator(".page-title")).toHaveText("替代料查询");
  // 措辞纪律:必须写明这是候选、须人工确认,且未知参数不按 0 分计
  await expect(page.getByText(/必须由工程按参数、封装、合规逐项人工确认/)).toBeVisible();
  await expect(page.getByText(/未知参数不按 0 分计入/)).toBeVisible();

  // ① 读规格:拉出被替代件的参数,作为默认优先级
  await page.getByLabel("待查型号").fill("STM32F103C8T6");
  await page.getByRole("button", { name: "读取规格与参数" }).click();
  await expect(page.getByText("参数优先级与范围")).toBeVisible({ timeout: 120_000 });

  // 优先级可调整(顺序即权重)
  await expect(page.getByRole("button", { name: /^下移/ }).first()).toBeVisible();

  // 分类徽标(来自 ezPLM 的 category)
  await expect(page.getByText(/微控制器|MCU/).first()).toBeVisible();

  // 参数优先级可拖拽(拖拽手柄存在),↑↓ 作为键盘可达的等价操作
  await expect(page.getByRole("button", { name: /^上移/ }).first()).toBeVisible();

  // ② 选 Pin-to-Pin 模式后分析
  await page.getByRole("button", { name: "Pin-to-Pin", exact: true }).click();
  await page.getByRole("button", { name: "开始替代分析" }).click();

  /*
   * 只在**结果区**里找 —— 页面说明与左栏也含"结论可信""市场行情"这些词,
   * 用全页定位会在结果还没回来时就误判成功。
   */
  const panel = page.getByTestId("alt-results");
  await expect
    .poll(
      async () =>
        (await panel.getByText("结论可信").count()) +
        (await panel.getByText(/未找到够格的替代候选/).count()),
      { timeout: 180_000 },
    )
    .toBeGreaterThan(0);

  // 有候选时:四个维度都要在,且 Pin-to-Pin 必须给引脚未验证的警示
  if ((await panel.getByText("结论可信").count()) > 0) {
    for (const label of ["技术兼容", "证据覆盖", "来源可信", "结论可信"]) {
      await expect(panel.getByText(label).first()).toBeVisible();
    }
    await expect(panel.getByText(/引脚映射尚未验证/).first()).toBeVisible();
  }
});

test("市场行情:显示阶梯价与供货,并明示非实时且不做汇率换算", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/materials/alternates");

  await page.getByLabel("待查型号").fill("STM32F103C8T6");
  await page.getByRole("button", { name: "读取规格与参数" }).click();
  await expect(page.getByText("参数优先级与范围")).toBeVisible({ timeout: 120_000 });

  // 行情开关默认开启,并写明它会消耗配额
  const toggle = page.getByRole("checkbox", { name: /查询市场行情/ });
  await expect(toggle).toBeChecked();
  await expect(page.getByText(/会消耗配额/)).toBeVisible();

  // 询价数量决定供货档位基准
  await page.getByLabel(/询价数量/).fill("100");
  await page.getByRole("button", { name: "开始替代分析" }).click();

  const panel = page.getByTestId("alt-results");
  await expect
    .poll(
      // 三种都是合法终局:拿到行情 / 没有候选 / 有候选但数据源没给行情
      // (CI 不注入三方 Key,走 Mock,正常会落到第三种)
      async () =>
        (await panel.getByText("市场行情").count()) +
        (await panel.getByText(/未找到够格的替代候选/).count()) +
        (await panel.getByText(/未取到行情/).count()),
      { timeout: 240_000 },
    )
    .toBeGreaterThan(0);

  if ((await panel.getByText(/未取到行情/).count()) > 0) {
    // 无凭据环境:必须说清"查不到"而不是留白,也不得暗示无货
    await expect(panel.getByText(/不代表无货或无价/).first()).toBeVisible();
  }

  if ((await panel.getByText("市场行情").count()) > 0) {
    // 诚实 UI:非实时、目录价、不含税费
    await expect(panel.getByText(/非实时行情/).first()).toBeVisible();
    await expect(panel.getByText(/不含关税/).first()).toBeVisible();
    await expect(panel.getByText(/供货:/).first()).toBeVisible();
  }
});
