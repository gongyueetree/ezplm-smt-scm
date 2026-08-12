import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

/**
 * E1a / 客户 Q13:「以系统内已经生成的正常 BOM 导入,**AI 无法全部识别,数据会丢失**」。
 *
 * 这是 P0 数据完整性用例,用**真实 xlsx、100 行**跑完整链路,证明:
 *
 *   原始行数 = 已识别 + 并入上一行 + 非业务行 + 待人工判断
 *
 * 且**没有任何一行凭空消失**。
 *
 * 混进去的脏数据(客户指定):空 MFG、中文描述、合并单元格、多 MPN、
 * 非标准列名、重复位号、缺描述、尾部空行。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

interface Built {
  buffer: Buffer;
  /** 表头之后的物理行数 —— 对账的分母 */
  bodyRows: number;
  /** 非空的业务行(空行/重复表头之外的一切)*/
  businessRows: number;
}

/**
 * 造一份 100 行的脏 BOM。
 *
 * **列名故意用非标准写法**(`Ref`/`Q'ty`/`Manufacturer P/N`),
 * 正是客户会遇到的那种"系统自己导出的表换个模板就认不全"。
 */
async function buildDirtyBom(tag: string, rowCount = 100): Promise<Built> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOM");

  // 表格上方的标题块 —— 真实 BOM 常有,表头并不在第一行
  ws.addRow([`${tag} 电子有限公司 BOM`]);
  ws.addRow(["项目:E2E-INTEGRITY", "版本:V1.0"]);
  const header = ["Ref", "Q'ty", "Manufacturer", "Manufacturer P/N", "Package", "Description"];
  ws.addRow(header);

  let bodyRows = 0;
  let businessRows = 0;
  const add = (cells: (string | number)[], business: boolean) => {
    ws.addRow(cells);
    bodyRows += 1;
    if (business) businessRows += 1;
  };

  for (let i = 1; i <= rowCount; i++) {
    if (i % 19 === 0) {
      // 尾部/中段空行
      add(["", "", "", "", "", ""], false);
    } else if (i % 23 === 0) {
      // 翻页重复表头
      add([...header], false);
    } else if (i % 17 === 0) {
      // 空 MFG + 缺描述
      add([`R${i}`, 1, "", `${tag}-MPN-${i}`, "0603", ""], true);
    } else if (i % 13 === 0) {
      // 一格里塞两个 MPN(客户真实场景:多 MPN)
      add([`R${i}`, 2, "Yageo", `${tag}-MPN-${i} / ${tag}-ALT-${i}`, "0603", "多料号一格"], true);
    } else if (i % 11 === 0) {
      // 只有描述,没有任何料号与位号 —— 旧实现在这里静默丢行
      add(["", "", "", "", "", `附注:第 ${i} 段说明文字`], true);
    } else if (i % 7 === 0) {
      // 合并单元格的典型形态:位号折行(上一行数量大于已列位号数)
      add([`R${i}A,R${i}B,R${i}C`, 6, "Murata", `${tag}-MPN-${i}`, "0603", "中文描述:电容 0.1uF"], true);
      add([`R${i}D,R${i}E,R${i}F`, "", "", "", "", ""], true);
      // 上面 add 了两行,循环变量只走一步 —— 计数已在 add 内累加,无需额外处理
    } else if (i % 5 === 0) {
      // 重复位号(与前一条同位号)
      add([`R${i - 1}`, 1, "TI", `${tag}-MPN-${i}`, "SOT-23", "中文描述:重复位号"], true);
    } else {
      add([`R${i}`, 1, "Yageo", `${tag}-MPN-${i}`, "0603", `中文描述 ${i}`], true);
    }
  }

  // 尾部空行(客户点名)
  for (let k = 0; k < 5; k++) add(["", "", "", "", "", ""], false);

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), bodyRows, businessRows };
}

test("100 行脏 BOM:每一行都有去向,账必须平,**不允许 silent drop**", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, "engineering@demo.qianchuang.cn");

  const tag = `INTEG${Date.now().toString(36).toUpperCase()}`;
  const built = await buildDirtyBom(tag);

  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles({
    name: `${tag}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: built.buffer,
  });
  await page.getByRole("button", { name: "开始导入" }).click();

  const recon = page.getByTestId("import-reconciliation");
  await expect(recon).toBeVisible({ timeout: 90_000 });

  // 逐个读回 KPI 数字,自己算一遍账 —— 不信任页面上那句"账已平"
  const num = async (label: string) => {
    const txt = await recon.locator(".kpi", { hasText: label }).locator(".kpi-value").innerText();
    return Number(txt.trim());
  };
  const total = await num("原始行数");
  const recognized = await num("已识别为物料");
  const merged = await num("并入上一行");
  const nonBusiness = await num("非业务行");
  const needsReview = await num("待人工判断");

  // ① 原始行数必须等于我们真的写进文件的行数 —— 不能在读文件时就先少几行
  expect(total, "原始行数应等于表头之后写入的物理行数").toBe(built.bodyRows);

  // ② 账必须平:这就是客户那句"另外 8 行去哪了"的答案
  expect(recognized + merged + nonBusiness + needsReview).toBe(total);
  await expect(page.getByTestId("recon-balanced")).toBeVisible();
  await expect(page.getByTestId("recon-unbalanced")).toHaveCount(0);

  // ③ 非空业务行一行都不能少:要么识别、要么并入、要么待人工,没有第四种
  expect(recognized + merged + needsReview).toBe(built.businessRows);

  // ④ 空行与重复表头**被计入总数**,不是先偷偷减掉再对账
  expect(nonBusiness).toBeGreaterThan(0);

  // ⑤ 那些"没能判定"的行必须真的能逐行看到,而不是只有一个数字
  if (needsReview > 0) {
    await page.getByRole("link", { name: "行去向明细" }).first().click();
    await expect(page.locator(".page-title")).toHaveText("行去向明细");
    const table = page.getByTestId("raw-row-table");
    await expect(table.locator("tbody tr").first()).toBeVisible();
    // 原始内容要留着,人才能自己判断系统处理得对不对
    await expect(table).toContainText("附注:第");
  }
});

test("行去向明细页可按分类下钻,且原始内容可见", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, "engineering@demo.qianchuang.cn");

  /*
   * 下钻这条只验 UI,不验 100 行的完整性结论 —— 用 24 行足够,
   * 各类去向都会出现。把重活留给上面那条用例:
   * 两条都跑 100 行会让整个套件的并发负载明显变重,
   * 表现是**别的用例**开始随机超时(实测全量从 2.9m 涨到 4.2m,
   * 每次挂的还不是同一条)。
   */
  const tag = `DRILL${Date.now().toString(36).toUpperCase()}`;
  const built = await buildDirtyBom(tag, 24);
  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles({
    name: `${tag}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: built.buffer,
  });
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByTestId("import-reconciliation")).toBeVisible({ timeout: 90_000 });

  await page.getByRole("link", { name: "行去向明细" }).first().click();
  await expect(page.locator(".page-title")).toHaveText("行去向明细");

  // 点「空行」这一类,应当只剩空行
  await page.locator(".kpi", { hasText: "空行" }).first().click();
  const table = page.getByTestId("raw-row-table");
  await expect(table.locator("tbody tr").first()).toContainText("空行");
  await expect(page.getByRole("link", { name: "清除筛选" })).toBeVisible();
});

test("导入历史每一条都能进到行去向", async ({ page }) => {
  await login(page, "engineering@demo.qianchuang.cn");
  await page.goto("/bom/imports");
  const first = page.locator("table.tbl tbody tr").first();
  await expect(first.getByRole("link", { name: "行去向" })).toBeVisible();
});
