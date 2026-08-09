import { expect, test, type Page } from "@playwright/test";

/**
 * A-5 回归:**草稿物料不得进入正式 BOM** —— 这条守卫必须对**所有**确认路径生效。
 *
 * PR-F 在 `saveLineDecision` 里加了守卫,但它只看 `input.partId`。
 * 而「采纳此候选」这条路径前端只发 `candidateId`(见 review.tsx 的 decide()),
 * partId 为空 —— 守卫压根不触发。同时 `buildMatchContext` 拉的是**全部** Part、
 * 不过滤状态,于是草稿料会正常出现在候选列表里,点一下就进了正式 BOM。
 *
 * 后果不是"多一条脏数据":BOM 行是报价、GTB、采购、追溯的共同上游,
 * 一颗没人审过的料会一路流到客户报价单上。
 *
 * 本用例走**真实 UI**(用户就是这么点的),不依赖内部接口。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

test("**采纳候选**这条路径同样不得让草稿物料进入正式 BOM", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const u = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const mpn = `A5DRAFT${u}`;

  // 1) 建一颗**草稿**料 —— 还没人审
  const part = await page.request.post("/api/materials/parts", {
    data: {
      target: "DRAFT",
      internalPn: `EE-A5D-${u}`,
      mpn,
      categoryL1: "IC",
      manufacturer: "E2ECORP",
      description: "A5 草稿料守卫用例",
    },
  });
  expect(part.status(), await part.text()).toBe(201);
  expect((await part.json()).status).toBe("DRAFT");

  // 2) 导入一张引用该 MPN 的 BOM
  const csv = `位号,数量,厂商,型号,封装,描述\nU1,1,E2ECORP,${mpn},SOT-23,A5 守卫用例\n`;
  await page.goto("/bom/import");
  await page.getByLabel("选择文件(可多选)").setInputFiles({
    name: `a5-guard-${u}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/· 已完成/)).toBeVisible({ timeout: 60_000 });

  // 3) 进匹配确认页
  await page.getByRole("link", { name: "与其它版本比对" }).click();
  await expect(page).toHaveURL(/\/bom\/compare\?to=/);
  const versionId = new URL(page.url()).searchParams.get("to")!;
  expect(versionId, "导入后应能拿到版本 id").toBeTruthy();
  await page.goto(`/bom/version/${versionId}`);

  const row = page.locator("table.tbl tbody tr").filter({ hasText: mpn });
  await expect(row, "刚导入的那行应出现在匹配确认页").toHaveCount(1);

  /*
   * 候选里出现草稿料本身**不是**缺陷 —— 匹配阶段就该把看到的都摆出来,
   * 藏起来反而让人不知道库里已经有这颗料(只是还没审)。
   * 要守的是:候选可以显示,但**不得被采纳**,且必须说清为什么。
   */
  const accept = row.getByRole("button", { name: "采纳此候选" }).first();
  await expect(accept, "草稿料应作为候选出现(可见但不可采纳)").toBeVisible();
  await accept.click();

  // 注意别用裸 getByRole("alert") —— Next 的路由播报器
  // (#__next-route-announcer__)也是 role=alert,会先命中且永远是空串
  const banner = page.locator(".banner.warn[role=alert]");
  await expect(banner, "采纳草稿料必须被拒并给出可执行的说明").toBeVisible();
  await expect(banner).toContainText("草稿");
  await expect(banner).toContainText("提交审核");

  // 被拒之后不得留下"已采纳"状态 —— 否则页面会显示成确认过了
  await expect(row.getByRole("button", { name: "✓ 已采纳" })).toHaveCount(0);
});
