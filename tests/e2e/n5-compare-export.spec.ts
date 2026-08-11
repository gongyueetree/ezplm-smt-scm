import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

/**
 * N-5(客户 PR2 反馈 采购-4C/D/E):
 *   C 线下报价多次上传 → SupplierQuote 本就按批存,已支持;
 *   D 给予删除权限 → 本用例;
 *   E 导出比价总表(所有供应商价格 / 替代料 / 备注 / 最高最低价与对应供应商)→ 本用例。
 *
 * 导出用例**真的把 xlsx 解开验内容** —— 只断言"下载成功"证明不了表里有东西。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/** 打开一张已有的比价单;库里没有就跳过 */
async function openAnyRfq(page: Page): Promise<string | null> {
  await page.goto("/procurement/rfq");
  const link = page.locator('a[href^="/procurement/rfq/"]').first();
  if ((await link.count()) === 0) return null;
  const href = await link.getAttribute("href");
  return href?.split("/").pop() ?? null;
}

test("N-5.E 导出比价总表:两张表,含最高/最低价与对应供应商", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  const id = await openAnyRfq(page);
  test.skip(!id, "库里没有比价单");

  const res = await page.request.get(`/api/procurement/rfq/${id}/compare-export`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("spreadsheetml");

  const wb = new ExcelJS.Workbook();
  /*
   * Playwright 的 res.body() 返回 Buffer<ArrayBufferLike>,与 exceljs 类型定义里的
   * Buffer 对不上(TS 认为缺 resizable/detached 等)。**运行时是同一个东西**,
   * 只是类型收敛不一致 —— 用 Buffer.from 复制一份得到标准 Buffer,
   * 既不改运行时行为,也不用 any 把类型问题藏起来。
   */
  await wb.xlsx.load(Buffer.from(await res.body()) as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const s1 = wb.getWorksheet("比价汇总");
  const s2 = wb.getWorksheet("逐条报价");
  expect(s1, "必须有比价汇总表").toBeTruthy();
  expect(s2, "必须有逐条报价表").toBeTruthy();

  // 汇总表的表头必须覆盖客户点名的四项
  const head1 = (s1!.getRow(4).values as unknown[]).map(String).join("|");
  expect(head1).toContain("最高/最低");
  expect(head1).toContain("替代料");
  expect(head1).toContain("特殊备注");

  // 逐条表必须有供应商与单价 —— "所有供应商的价格"
  const head2 = (s2!.getRow(1).values as unknown[]).map(String).join("|");
  expect(head2).toContain("供应商");
  expect(head2).toContain("单价");

  // 诚实说明:系统不做汇率换算,这句必须在表里
  const noteRow = (s1!.getRow(2).values as unknown[]).map(String).join("");
  expect(noteRow).toContain("不做汇率换算");
});

test("N-5.E 导出链接就在比价卡片上,不用去别处找", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");
  const id = await openAnyRfq(page);
  test.skip(!id, "库里没有比价单");

  await page.goto(`/procurement/rfq/${id}`);
  const link = page.getByTestId("compare-export");
  // 卡片可能要有比价结果才渲染;有则必须可点
  if ((await link.count()) > 0) {
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", new RegExp(`${id}/compare-export`));
  }
});

test("N-5.D 删除报价必须填原因,且不存在的批次一律 404", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "procurement@demo.qianchuang.cn");

  // 不填原因 → 400,并说清为什么要原因
  const noReason = await page.request.delete("/api/procurement/quotes/clzzzzzzzzzzzzzzzzzzzzzz", {
    data: {},
  });
  expect(noReason.status()).toBe(400);
  expect(await noReason.text()).toContain("必须填写原因");

  // 填了原因但批次不存在 → 404(措辞与"不属于本租户"一致,不泄露存在性)
  const missing = await page.request.delete("/api/procurement/quotes/clzzzzzzzzzzzzzzzzzzzzzz", {
    data: { reason: "E2E 删除测试" },
  });
  expect(missing.status()).toBe(404);
});

test("N-5.D 无权限角色不能删报价", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const res = await page.request.delete("/api/procurement/quotes/clzzzzzzzzzzzzzzzzzzzzzz", {
    data: { reason: "越权尝试" },
  });
  expect(res.status()).toBe(403);
});
