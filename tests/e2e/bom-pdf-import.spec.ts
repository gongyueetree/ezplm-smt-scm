import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * 图片 / PDF BOM 导入 E2E(客户需求:PDF/图片 BOM 自动识别成规范化 BOM)。
 *
 * 两条路径必须**被区分开**并如实标注:
 * - PDF 有文本层 → 坐标重建,确定性,不动用模型;
 * - 图片 / 扫描件 → 模型转写草稿;未配置 ANTHROPIC_API_KEY 时
 *   必须明确说"未配置、已归档、请人工补录",不得静默失败也不得假装识别。
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";
const PDF_FIXTURE = path.join(__dirname, "fixtures", "demo-bom.pdf");
const SCAN_FIXTURE = path.join(__dirname, "fixtures", "demo-bom-scan.png");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("PDF(含文本层)BOM:自动重建表格并识别列映射,标注为确定性解析", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.ezplm.cn");
  await page.goto("/bom/import");

  await page.getByLabel("选择文件(可多选)").setInputFiles(PDF_FIXTURE);
  await page.getByRole("button", { name: "开始导入" }).click();

  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 120_000 });

  // 来源标注:确定性解析,不能被写成"AI 识别"
  await expect(page.getByText("PDF 文本层重建(确定性)")).toBeVisible();
  await expect(page.getByText(/PDF 含文本层,已按坐标重建表格/)).toBeVisible();
  // 未走模型 → 不得出现草稿警告
  await expect(page.getByText(/本次表格来自.*模型转写/)).toHaveCount(0);

  // 列映射识别到了 MPN 与数量(否则这份 PDF 等于没解析出来)
  await expect(page.getByText("MPN →", { exact: false })).toBeVisible();
  await expect(page.getByText("数量 →", { exact: false })).toBeVisible();

  // 表格内容真的进了 BOM(而不是空壳作业):4 条物料、4 个唯一 MPN
  await expect(page.getByText(/4 行 · 4 个唯一 MPN/)).toBeVisible();
});

test("图片 BOM:未配置识别凭据时如实说明已归档待人工补录,不静默失败", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.ezplm.cn");
  await page.goto("/bom/import");

  await page.getByLabel("选择文件(可多选)").setInputFiles(SCAN_FIXTURE);
  await page.getByRole("button", { name: "开始导入" }).click();

  // 两种结局都可接受,但都必须**有明确结论**:
  // ①未配置凭据 → 明说已归档、需人工补录;②已配置 → 走草稿路径并警示逐行核对
  await expect
    .poll(
      async () =>
        (await page.getByText(/请人工补录|已归档/).count()) +
        (await page.getByText(/模型转写/).count()),
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0);

  // 无论哪条路,都不得出现"识别成功"之类没有依据的完成态
  await expect(page.getByText(/识别成功|已自动识别完成/)).toHaveCount(0);
});
