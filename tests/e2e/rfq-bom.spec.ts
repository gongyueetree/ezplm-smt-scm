import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * PR5 业务流程 E2E(SPEC §17 第 1–3 项):
 * ① PM 创建 RFQ 并上传多个附件
 * ② RFQ 关闭为不报价
 * ③ BOM 导入、匹配、人工确认
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";
const FIXTURE = path.join(__dirname, "fixtures", "demo-bom.csv");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

async function createRfq(page: Page, title: string) {
  await page.goto("/rfq");
  await page.getByLabel("标题").fill(title);
  await page.getByRole("button", { name: "创建 RFQ" }).click();
  await expect(page).toHaveURL(/\/rfq\/[^/]+$/);
}

test("PM 创建 RFQ 并上传多个附件(SPEC §17-1)", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await createRfq(page, "E2E 控制板询价");

  await expect(page.locator(".page-title")).toContainText("E2E 控制板询价");
  await expect(page.locator(".badge", { hasText: "草稿" }).first()).toBeVisible();

  // 上传两个附件(保留原始客户文件)
  await page.getByLabel("附件类型").selectOption("GERBER");
  await page.getByLabel("选择文件(可多选,保留原始客户文件)").setInputFiles([FIXTURE, FIXTURE]);
  await page.getByRole("button", { name: "上传附件" }).click();

  await expect(page.getByText("已保存 2 个原始文件")).toBeVisible();
  await expect(page.locator("text=下载原件").first()).toBeVisible();
  // 处理记录里有创建记录
  await expect(page.getByText("创建 RFQ")).toBeVisible();
});

test("RFQ 不报价关闭:必须填原因,关闭后进入终态(SPEC §17-2)", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await createRfq(page, "E2E 不报价关闭");

  // 取消填写原因 → 不发生流转
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "不报价并关闭" }).click();
  await expect(page.locator(".page-actions .badge")).toHaveText("草稿");

  // 填写原因 → 关闭成功
  page.once("dialog", (d) => d.accept("客户取消项目"));
  await page.getByRole("button", { name: "不报价并关闭" }).click();

  await expect(page.locator(".page-actions .badge")).toHaveText("不报价关闭");
  await expect(page.locator(".banner.warn")).toContainText("客户取消项目");
  // 终态:无可执行流转
  await expect(page.getByText("当前状态为终态或当前角色无可执行流转")).toBeVisible();
});

test("BOM 导入 → 校验 → 匹配 → 人工确认(SPEC §17-3)", async ({ page }) => {
  await login(page, "pm@demo.ezplm.cn");
  await page.goto("/bom/import");

  await page.getByLabel("选择文件(可多选)").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "开始导入" }).click();

  // ② 列映射:跳过前置标题行,识别中文表头
  await expect(page.getByText("列映射识别结果")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".badge", { hasText: "MPN → 第 4 列" })).toBeVisible();

  // ③ 校验:EOL 料被检出
  await expect(page.getByText("导入校验")).toBeVisible();
  await expect(page.getByText(/MAX232CPE 生命周期为 EOL/)).toBeVisible();

  // ④ 匹配进度跑到 100%
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });

  // 进入人工确认页
  await page.getByRole("link", { name: "进入匹配确认(需人工确认)" }).click();
  await expect(page).toHaveURL(/\/bom\/version\/[^/]+$/);

  await expect(page.getByText("待人工确认")).toBeVisible();
  await expect(page.getByText(/仅为建议/)).toBeVisible();

  // 候选展示了来源与数据更新时间(诚实 UI)
  const firstCandidate = page.locator("table.tbl tbody tr").first();
  await expect(firstCandidate).toContainText("数据更新");

  // 人工采纳第一条候选
  await page.getByRole("button", { name: "采纳此候选" }).first().click();
  await expect(page.locator(".badge", { hasText: "已确认" }).first()).toBeVisible();
});

test("BOM 台账与版本比对入口可达", async ({ page }) => {
  await login(page, "engineering@demo.ezplm.cn");
  await page.goto("/bom");
  await expect(page.locator(".page-title")).toHaveText("BOM 管理");

  await page.goto("/bom/compare");
  await expect(page.locator(".page-title")).toHaveText("版本比对");
  // 子页面返回按钮(SPEC §2)
  await expect(page.locator(".back-link")).toBeVisible();
});
