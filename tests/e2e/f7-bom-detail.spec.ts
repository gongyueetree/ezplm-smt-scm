import { expect, test, type Page } from "@playwright/test";

/**
 * F7 · BOM 详情页(spec §9 验收):
 * 进入详情 → 筛选需人工确认 → 单行确认 → 批量确认(取消一条)→ 版本对比导出 → 返回;
 * 外加 Feature Flag 门控(关闭不渲染;开启无数据显示空态)。
 *
 * BOM 经 API 导入产生(与向导同一管线,匹配分批跑完)。
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/");
}

/** 与 demo 种子物料对齐的小 BOM:精确 MPN 命中出高置信候选,末行无中生有出未识别。
 *  幂等键按文件内容算 —— 三个用例并发导入必须内容各异,加一行唯一标记行。 */
const makeCsv = (tag: string) =>
  [
    "位号,用量,制造商,制造商料号,封装,描述",
    "R1,4,Yageo,RC0603FR-0710KL,0603,RES 10K 1% 0603",
    "C1,10,Murata,GRM188R71H104KA93D,0603,CAP 0.1uF 50V",
    "U1,1,STMicroelectronics,STM32F103C8T6,LQFP-48,MCU",
    "U2,1,Texas Instruments,MAX232CPE,DIP-16,RS-232 收发器",
    `X9,1,,F7-GHOST-NO-SUCH-PART-999,,幽灵料(必然无候选)${tag}`,
  ].join("\n");

async function importBom(page: Page): Promise<{ bomId: string; versionId: string }> {
  const res = await page.request.post("/api/bom/import", {
    multipart: {
      files: {
        name: `f7-detail-${Date.now()}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(makeCsv(`·${Date.now()}·${Math.random().toString(36).slice(2, 8)}`), "utf-8"),
      },
    },
  });
  expect(res.status(), await res.text().then((t) => t.slice(0, 300))).toBe(201);
  const body = await res.json();
  const jobId: string = body.job.id;
  const bomId: string = body.job.bomId;
  const versionId: string = body.bomVersionId;

  // 匹配分批跑完(小 BOM 数轮即完)
  for (let i = 0; i < 30; i++) {
    const step = await page.request.get(`/api/bom/import/${jobId}`);
    const s = await step.json();
    if (s.job?.status === "SUCCEEDED" || s.job?.status === "FAILED" || s.done) break;
  }
  return { bomId, versionId };
}

test("详情页全流程:筛选 → 单行确认 → 批量确认(取消一条)→ 对比导出 → 返回", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const { bomId } = await importBom(page);

  // ① 进入详情:KPI 条 + 阈值来自租户配置(默认 90%)
  await page.goto(`/bom/${bomId}`);
  await expect(page.getByTestId("bom-detail-title")).toBeVisible();
  await expect(page.getByTestId("bom-kpis")).toBeVisible();
  await expect(page.getByTestId("kpi-needs-review")).toContainText("90%");

  // ② 筛选:未识别 → 只剩幽灵料那一行
  await page.getByTestId("review-filter-unrecognized").click();
  await expect(page.locator("table.tbl tbody tr")).toHaveCount(1);
  await expect(page.locator("table.tbl tbody")).toContainText("F7-GHOST");

  // 回到全部
  await page.getByTestId("review-filter-all").click();
  const allRows = await page.locator("table.tbl tbody tr").count();
  expect(allRows).toBe(5);

  // ③ 单行确认:采纳第一条候选
  await page.getByRole("button", { name: "采纳此候选" }).first().click();
  await expect(page.locator(".badge", { hasText: "已确认" }).first()).toBeVisible();

  // ④ 批量确认:打开确认卡片 → 取消一条 → 提交;结果如实回报条数
  const bulkBtn = page.getByTestId("bulk-confirm-open");
  await expect(bulkBtn).toBeEnabled();
  const eligibleText = await bulkBtn.innerText(); // 「一键确认高置信匹配(N 行 ≥ 90%)」
  const eligibleCount = Number(/(\d+) 行/.exec(eligibleText)?.[1] ?? "0");
  expect(eligibleCount).toBeGreaterThanOrEqual(2);

  await bulkBtn.click();
  const card = page.getByTestId("bulk-confirm-card");
  await expect(card).toContainText("确认卡片");
  await expect(card).toContainText("90%");

  // 取消勾选第一条
  const firstCheckbox = card.locator('input[type="checkbox"]').first();
  await firstCheckbox.uncheck();
  await page.getByTestId("bulk-confirm-submit").click();

  await expect(card).toContainText("批量确认完成", { timeout: 30_000 });
  await expect(card).toContainText(`已确认 ${eligibleCount - 1} 行`);

  // ⑤ 版本 Tab → 对比导出按钮在对比页(单版本无对比,直接验证导出路由与 diff 同源)
  await page.getByTestId("tab-versions").click();
  await expect(page.getByTestId("version-table")).toBeVisible();
  // 关联工单列:ERP 未配置 → 「待接入」,不显示 0
  await expect(page.getByTestId("version-table")).toContainText("待接入");

  // ⑥ 返回上一层(BackLink)
  await page.locator(".back-link").click();
  await expect(page).toHaveURL(/\/bom$/);
});

test("对比导出:与对比页同一 diff 函数产出 CSV(同版本自比 → 全部未变化)", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "engineering@demo.qianchuang.cn");
  const { versionId } = await importBom(page);

  const res = await page.request.get(`/api/bom/compare/export?from=${versionId}&to=${versionId}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const text = await res.text();
  // 自比:0 变更;汇总注释行如实写 0
  expect(text).toContain("新增 0 · 删除 0 · 数量变更 0 · 料号变更 0");
  expect(text).toContain("变更类型");
});

test("T2 Feature Flag:默认关闭不渲染;开启后显示空态(无示例数据)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "management@demo.qianchuang.cn");
  const { bomId } = await importBom(page);

  // 默认:manufacturing tab 不存在
  await page.goto(`/bom/${bomId}`);
  await expect(page.getByTestId("tab-manufacturing")).toHaveCount(0);
  // T3 占位卡存在且注明待商务确认
  await expect(page.getByTestId("t3-placeholder")).toContainText("待商务确认");

  // 开启两个 T2 flag(MANAGEMENT 经租户配置 API)
  const current = await (await page.request.get("/api/settings/tenant")).json();
  const put = await page.request.put("/api/settings/tenant", {
    data: {
      ...current.settings,
      featureFlags: {
        ...current.settings.featureFlags,
        "bom.manufacturingInfo": true,
        "bom.versionGraph": true,
      },
    },
  });
  expect(put.status()).toBe(200);

  try {
    await page.goto(`/bom/${bomId}`);
    await page.getByTestId("tab-manufacturing").click();
    await expect(page.getByTestId("manufacturing-panel")).toBeVisible();
    // 无数据 → 空态,绝无示例数据
    await expect(page.getByTestId("mfg-empty")).toContainText("待录入");

    // 版本图谱随 flag 出现
    await page.getByTestId("tab-versions").click();
    await expect(page.getByTestId("version-graph")).toBeVisible();
  } finally {
    // 还原 flag,不污染其它用例
    await page.request.put("/api/settings/tenant", { data: current.settings });
  }
});
