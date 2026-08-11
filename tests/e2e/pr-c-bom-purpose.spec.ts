import path from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * PR-C / PR2-PM-03 + PR2-ENG-02:预 BOM(报价用)与正式 BOM(量产用)拆分 + 一键转换。
 *
 * 客户 Q4 答复:「A. 分两套 + 一键转换;正式 BOM 必须关联客户编码,
 * 且要优先匹配系统内部料号」。
 *
 * 本组用例守三条:
 * ① 没选客户不许转;
 * ② 试算**不落库**,页面必须说清楚;
 * ③ 转换生成**新 BOM**,原预 BOM 一个字都不变。
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

/**
 * 自建一颗**本用例专属**的物料,并返回它的 MPN 与内部料号。
 *
 * 为什么不用种子物料:种子里的 STM32F103C8T6 会被其它用例反复拿去建
 * 「同 MPN 疑似重复」的料(manual-part.spec),跑几轮之后同一个 MPN 底下
 * 挂着几十颗内部料 —— 匹配结果从「精确命中」变成「多候选歧义」,
 * 断言具体数字的用例就会莫名其妙地红。前置数据必须由用例自己造。
 */
async function createUniquePart(page: Page) {
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const internalPn = `EE-PRC-${u}`;
  const mpn = `PRC-MPN-${u}`;
  const res = await page.request.post("/api/materials/parts", {
    data: {
      target: "ACTIVE",
      internalPn,
      mpn,
      categoryL1: "IC",
      manufacturer: "PRC-TEST",
      description: "PR-C 转换用例专属物料",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { internalPn, mpn, missingMpn: `PRC-NOPE-${u}` };
}

function bomCsv(mpns: string[]): Buffer {
  const rows = [
    "位号,用量,制造商,制造商料号,封装,描述",
    ...mpns.map((m, i) => `R${i + 1},1,PRC-TEST,${m},0603,PR-C 用例`),
  ];
  return Buffer.from(rows.join("\n"), "utf-8");
}

async function importBomBuffer(page: Page, buf: Buffer): Promise<string> {
  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles({
    name: `prc-${Date.now()}.csv`,
    mimeType: "text/csv",
    buffer: buf,
  });
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });
  const href = await page.getByRole("link", { name: /进入匹配确认/ }).first().getAttribute("href");
  expect(href, "导入后应能拿到 BOM 版本 id").toBeTruthy();
  return href!.split("/").pop()!;
}

async function importBom(page: Page): Promise<string> {
  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles(BOM_FIXTURE);
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });
  const href = await page.getByRole("link", { name: /进入匹配确认/ }).first().getAttribute("href");
  expect(href, "导入后应能拿到 BOM 版本 id").toBeTruthy();
  return href!.split("/").pop()!;
}

test("导入进来的是预 BOM;没选客户不许转正式", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "pm@demo.qianchuang.cn");
  const versionId = await importBom(page);

  await page.goto(`/bom/version/${versionId}`);
  await expect(page.getByText("预 BOM", { exact: true }).first()).toBeVisible();

  // 不选客户直接试算 → 必须被拦,并说明原因
  await page.getByRole("button", { name: "试算内部料号匹配" }).click();
  await expect(page.getByTestId("convert-note")).toContainText("必须关联客户", {
    timeout: 30_000,
  });
  // 硬闯:直接点确认转换 —— 必须被 422 拦下,且 URL 不变(没有生成任何东西)
  const before = page.url();
  await page.getByRole("button", { name: /确认转换/ }).click();
  await expect(page.getByTestId("convert-error")).toContainText("必须关联客户", { timeout: 30_000 });
  expect(page.url()).toBe(before);
});

test("选客户后试算:显示匹配/待补行数,并明说尚未生成任何正式 BOM", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const part = await createUniquePart(page);
  const versionId = await importBomBuffer(page, bomCsv([part.mpn, part.missingMpn]));

  await page.goto(`/bom/version/${versionId}`);
  await page.getByLabel("转换客户").selectOption({ label: "联创科技(深圳)" });
  await page.getByRole("button", { name: "试算内部料号匹配" }).click();

  const preview = page.getByTestId("convert-preview");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  /*
   * 2 行:一行是本用例自建的料(必中),一行是库里绝对没有的 MPN(必不中)。
   * **断言具体数字** —— 只断言「已匹配」三个字的话,标签永远在,用例永远绿。
   */
  await expect(preview).toContainText(/共\s*2\s*行/);
  await expect(preview).toContainText(/已匹配\s*1/);
  await expect(preview).toContainText(/未匹配\s*1/);
  await expect(preview).toContainText(part.internalPn);
  await expect(preview).toContainText("MPN 精确匹配");
  // 未匹配的行必须说清"不会自动建料",而不是留空
  await expect(preview).toContainText("不会自动建料");

  // 试算不落库 —— 这句必须在页面上
  await expect(page.getByTestId("convert-note")).toContainText("尚未生成任何正式 BOM");
});

test("确认转换:生成新的正式 BOM,原预 BOM 保持不变", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const part = await createUniquePart(page);
  const versionId = await importBomBuffer(page, bomCsv([part.mpn, part.missingMpn]));

  await page.goto(`/bom/version/${versionId}`);
  await page.getByLabel("转换客户").selectOption({ label: "联创科技(深圳)" });
  await page.getByRole("button", { name: "试算内部料号匹配" }).click();
  await expect(page.getByTestId("convert-preview")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /确认转换/ }).click();
  // 跳到新版本页
  await page.waitForURL(new RegExp(`/bom/version/(?!${versionId})`), { timeout: 60_000 });
  await expect(page.getByTestId("convert-panel-production")).toContainText("正式 BOM 不再转换");
  await expect(page.getByText("正式 BOM", { exact: true }).first()).toBeVisible();

  // 原预 BOM 没被改成正式 —— 报价依据不能被转换动过
  await page.goto(`/bom/version/${versionId}`);
  await expect(page.getByText("预 BOM", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("convert-panel")).toBeVisible();

  // 台账上两份都在,且能分别筛出来
  await page.goto("/bom?purpose=PRODUCTION");
  const prodRows = page.locator("table.tbl tbody tr");
  await expect(prodRows.filter({ hasText: "正式 BOM" }).first()).toBeVisible();
  await expect(prodRows.filter({ hasText: "待补内部料号" }).first()).toBeVisible();

  await page.goto("/bom?purpose=PRE_QUOTE");
  await expect(page.locator("table.tbl tbody tr").filter({ hasText: "已转出" }).first()).toBeVisible();
});

test("PR2-ENG-04 工程工作台给出批量导入的显式入口", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  const shortcuts = page.getByTestId("workbench-shortcuts");
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts.getByRole("link", { name: "批量导入 BOM" })).toHaveAttribute(
    "href",
    "/bom/import",
  );
  await expect(shortcuts.getByRole("link", { name: "批量导入物料" })).toBeVisible();
  await shortcuts.getByRole("link", { name: "批量导入 BOM" }).click();
  await expect(page).toHaveURL(/\/bom\/import/);
});
