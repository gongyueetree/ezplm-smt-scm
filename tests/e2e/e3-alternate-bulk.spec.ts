import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

/**
 * E3 / 客户 Q9:「**物料替代的批量导入导出**需要输入口」。
 *
 * 用例守三条:
 * ① 逐行报错(不是整批一句"格式不对");
 * ② **不自动建料** —— 料号不存在就报错;
 * ③ 有坏行时**默认整批不执行**,除非显式选择只导好行。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

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

async function createPart(page: Page, internalPn: string) {
  const res = await page.request.post("/api/materials/parts", {
    data: {
      target: "ACTIVE",
      internalPn,
      mpn: `MPN-${internalPn}`,
      categoryL1: "IC",
      manufacturer: "E3-TEST",
      description: "E3 批量导入用例",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

const HEAD = [
  "基准内部料号", "基准制造商", "基准 MPN",
  "替代内部料号", "替代制造商", "替代 MPN",
  "功能等效", "封装兼容", "引脚兼容", "判定依据", "依据来源", "确认人", "备注",
];

async function xlsx(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("替代关系");
  ws.addRow(HEAD);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function upload(page: Page, buf: Buffer, name: string) {
  await page.goto("/materials/alternates");
  await page.getByLabel("替代料导入文件").setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });
}

test("预览只校验不写入,坏行逐行报错并指出行号", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const tag = uniqueTag();
  await createPart(page, `EE-${tag}-A`);
  await createPart(page, `EE-${tag}-B`);

  const buf = await xlsx([
    [`EE-${tag}-A`, "", "", `EE-${tag}-B`, "", "", "EXACT", "MINOR_VARIATION", "PIN_TO_PIN", "同规格", "MANUAL", "", ""],
    // 兼容级别写错 —— 不能被悄悄当成 UNKNOWN
    [`EE-${tag}-A`, "", "", `EE-${tag}-B`, "", "", "FUNCTIONAL", "EXACT", "PIN_TO_PIN", "", "", "", ""],
    // 料号不存在 —— 不能自动建料
    [`EE-${tag}-NOPE`, "", "", `EE-${tag}-B`, "", "", "EXACT", "EXACT", "PIN_TO_PIN", "", "", "", ""],
  ]);
  await upload(page, buf, `alt-${tag}.xlsx`);
  await page.getByTestId("alt-preview").click();

  const result = page.getByTestId("alt-preview-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText("尚未写入");

  const errors = page.getByTestId("alt-errors");
  await expect(errors).toContainText("不是合法取值");
  await expect(errors).toContainText("系统不会自动建");
  // 行号指得回原表(表头是第 1 行,坏行分别是第 3、4 行)
  await expect(errors.locator("tbody tr").first()).toContainText("3");
});

test("**有坏行时默认整批不执行**;勾选后只导好行", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const tag = uniqueTag();
  await createPart(page, `EE-${tag}-A`);
  await createPart(page, `EE-${tag}-B`);

  const buf = await xlsx([
    [`EE-${tag}-A`, "", "", `EE-${tag}-B`, "", "", "EXACT", "EXACT", "PIN_TO_PIN", "好行", "MANUAL", "", ""],
    [`EE-${tag}-A`, "", "", `EE-${tag}-NOPE`, "", "", "EXACT", "EXACT", "PIN_TO_PIN", "坏行", "", "", ""],
  ]);
  await upload(page, buf, `alt2-${tag}.xlsx`);
  await page.getByTestId("alt-preview").click();
  await expect(page.getByTestId("alt-preview-result")).toBeVisible({ timeout: 30_000 });

  // 直接执行 → 被拦,一条都不写
  await page.getByTestId("alt-execute").click();
  await expect(page.getByTestId("alt-error")).toContainText("整批未执行", { timeout: 30_000 });

  const before = await page.request
    .get(`/api/materials/alternates?q=EE-${tag}-`)
    .then((r) => r.json());
  expect(before.total).toBe(0);

  // 勾上"只导入通过校验的行" → 好行进去,坏行仍然报出来
  await page.getByLabel("只导入通过校验的行").check();
  await page.getByTestId("alt-execute").click();
  await expect(page.getByTestId("alt-note")).toContainText("另有 1 行未导入", { timeout: 30_000 });

  const after = await page.request
    .get(`/api/materials/alternates?q=EE-${tag}-`)
    .then((r) => r.json());
  expect(after.total).toBe(1);
});

test("导入模板与导出文件都可下载,且模板列与导入一致", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/materials/alternates");

  const [tpl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("alt-template").click(),
  ]);
  expect(tpl.suggestedFilename()).toBe("alternate-template.xlsx");

  const wb = new ExcelJS.Workbook();
  const stream = await tpl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  await wb.xlsx.load(Buffer.concat(chunks) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const header = wb.getWorksheet("替代关系")!.getRow(1).values as unknown[];
  expect(header).toContain("功能等效");
  expect(header).toContain("封装兼容");
  expect(header).toContain("引脚兼容");
  // 取值说明必须随模板一起给 —— 写错级别是最常见的导入错误
  const help = wb.getWorksheet("取值说明")!;
  expect(JSON.stringify(help.getSheetValues())).toContain("MINOR_VARIATION");
  expect(JSON.stringify(help.getSheetValues())).toContain("不会自动建料");

  const [exp] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("alt-export").click(),
  ]);
  expect(exp.suggestedFilename()).toBe("alternates.xlsx");
});
