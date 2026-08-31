import { expect, test, type Page } from "@playwright/test";

/**
 * E9 / 客户回复清单第 4 项:「典型文件大小:无固定大小,**BOM 较大 15MB**」。
 *
 * 这句话炸出两个真缺陷(都已修,本文件锁住它们):
 *
 * ① `/api/bom/import` 原在中间件路径下,body 在 10MB 处被静默截断,
 *    multipart 边界损坏后报错竟是「需要 multipart/form-data」——
 *    客户传一份 15MB 的正常 BOM,得到一句无从下手的错话;
 * ② 即使 body 完整进来,17000 行的导入事务超出 Prisma 默认 5s 超时 → 500。
 *
 * 另一半纪律:仍在中间件路径下的其它导入口,超过 10MB 必须**读 body 之前**
 * 就拒绝并说人话 —— 绝不允许收下被框架截断的残缺数据。
 *
 * 文件名带 zz- 前缀是刻意的:17000 行的导入要占服务器约 45 秒,
 * Playwright 大体按文件名调度 —— 排在中段会把并发中其它用例的登录导航
 * 饿到超时(实测 erp-reliability 因此连挂)。排到最后,互不干扰。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/** 生成超过 10MB 的 CSV,行数已知 —— 每行都要有去向 */
function bigCsv(rows: number): { buffer: Buffer; rows: number } {
  const pad = "描述填充".repeat(60);
  const lines = ["位号,用量,制造商,制造商料号,封装,描述"];
  for (let i = 1; i <= rows; i++) {
    lines.push(`R${i},1,Yageo,E9-MPN-${i},0603,${pad}行${i}`);
  }
  return { buffer: Buffer.from(lines.join("\n"), "utf-8"), rows };
}

test("**12MB / 17000 行 BOM 全量导入,一行不丢** —— 客户说他们的 BOM 就是这么大", async ({ page }) => {
  test.setTimeout(420_000);
  await login(page, "engineering@demo.qianchuang.cn");

  const { buffer, rows } = bigCsv(17_000);
  expect(buffer.byteLength, "夹具必须真的超过中间件 10MB 截断线").toBeGreaterThan(10 * 1024 * 1024);

  const res = await page.request.post("/api/bom/import", {
    multipart: {
      files: { name: `e9-big-${Date.now()}.csv`, mimeType: "text/csv", buffer },
    },
    timeout: 360_000,
  });
  expect(res.status(), await res.text().then((t) => t.slice(0, 300))).toBe(201);

  const body = await res.json();
  // E1a 的行去向对账在大文件上同样必须平:17000 行进,17000 行有去向
  expect(body.reconciliation.totalRows).toBe(rows);
  expect(body.reconciliation.recognized).toBe(rows);
  expect(body.reconciliation.balanced).toBe(true);
  expect(body.job.totalLines).toBe(rows);
});

test("仍在中间件路径下的导入口:超 10MB **读 body 之前就拒**,且报错说人话", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.qianchuang.cn");

  const { buffer } = bigCsv(16_000); // ~11.6MB
  const res = await page.request.post("/api/materials/alternates/bulk-import", {
    multipart: {
      file: { name: "big-alt.csv", mimeType: "text/csv", buffer },
      execute: "false",
    },
    timeout: 120_000,
  });
  expect(res.status()).toBe(413);
  const body = await res.json();
  expect(body.code).toBe("too_large");
  // 修复前的表现:截断 → multipart 损坏 → 「需要 multipart/form-data」。绝不允许回退到那个状态
  expect(body.error).not.toContain("需要 multipart/form-data");
  expect(body.error).toContain("静默截断");
  expect(body.error).toContain("10MB");
});
