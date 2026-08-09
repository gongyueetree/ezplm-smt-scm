import fs from "fs";
import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * PR9 补齐 SPEC §17 剩余两项:
 * ⑨ API 失败时显示降级信息
 * ⑩ 所有关键操作生成 AuditLog
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";
const BOM_FIXTURE = path.join(__dirname, "fixtures", "demo-bom.csv");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("⑨ 外部 API 失败时展示降级信息,且不阻断其余流程(SPEC §17-9)", async ({ page }) => {
  await login(page, "pm@demo.qianchuang.cn");

  // 拦截匹配进度接口,注入一条 provider 降级信息(服务端降级逻辑已由单测覆盖,
  // 此处验证 UI 是否如实展示而不是静默吞掉)
  await page.route("**/api/bom/import/*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.degraded = [
      { provider: "MOUSER", kind: "quota_exceeded", message: "Mouser 当日配额已用尽" },
    ];
    await route.fulfill({ response, json: body });
  });

  /*
   * 上传内容必须**每轮唯一**。
   *
   * 导入是按「文件内容 + 解析结果」幂等的:直接传固定夹具时,只要别的用例
   * (procurement / kitting-shortage / material-detail / backlog-b456 …
   * 都传同一个 demo-bom.csv)先跑过一次,这里就命中幂等复用既有作业 ——
   * 进度接口的调用形态随之改变,上面注入降级信息的拦截落空,横幅永远等不到。
   * 并行 worker 下这是一个随调度顺序时红时绿的假失败(实测在全量跑里出现过)。
   */
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const content = `${fs.readFileSync(BOM_FIXTURE, "utf8")}\nU9${stamp.slice(0, 5)},1,TI,SN74LVC1G08DBVR,SOT-23-5,唯一化用行\n`;

  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles({
    name: `audit-degrade-${stamp}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(content, "utf8"),
  });
  await page.getByRole("button", { name: "开始导入" }).click();

  // 降级信息如实展示
  await expect(page.getByText("外部数据源降级")).toBeVisible({ timeout: 60_000 });
  // 按内容定位到降级横幅本身:页面上可能同时有别的 warn 横幅(如幂等复用提示)
  await expect(
    page.locator(".banner.warn").filter({ hasText: "外部数据源降级" }),
  ).toContainText("MOUSER/quota_exceeded");

  // 不阻断:进度仍跑到完成,仍可进入匹配确认
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: /进入匹配确认/ })).toBeVisible();
});

test("⑩ 关键操作生成 AuditLog 并可在系统设置中查验(SPEC §17-10)", async ({ page }) => {
  // 先以 PM 执行一个关键写操作:创建 RFQ
  await login(page, "pm@demo.qianchuang.cn");
  await page.goto("/rfq");
  const title = `E2E 审计验证 ${Date.now()}`;
  await page.getByLabel("标题").fill(title);
  await page.getByRole("button", { name: "创建 RFQ" }).click();
  await expect(page).toHaveURL(/\/rfq\/[^/]+$/);
  const rfqId = page.url().split("/").pop()!;

  // 管理层在系统设置中查验审计记录
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings");

  const auditTable = page.locator(".card", { hasText: "审计日志" }).locator("table.tbl");
  await expect(auditTable).toContainText("RFQ_CREATE");
  await expect(auditTable).toContainText(rfqId.slice(0, 12));
  // 登录本身也是关键操作
  await expect(auditTable).toContainText("AUTH_LOGIN");
});

test("集成状态只用诚实措辞,不出现虚假完成态", async ({ page }) => {
  await login(page, "management@demo.qianchuang.cn");
  await page.goto("/settings");

  const integrationCard = page.locator(".card", { hasText: "集成状态" });
  await expect(integrationCard).toBeVisible();

  // 禁止出现"已完成/已生成/已发送"类虚假完成态
  const text = await integrationCard.innerText();
  expect(text).not.toMatch(/已完成|已发送|已生成/);
  // 必须出现受控措辞之一
  expect(text).toMatch(/示例配置|待授权|待联调|已联调/);
});
