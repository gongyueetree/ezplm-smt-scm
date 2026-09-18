/**
 * REF-1a 私有 UAT:归一规则差异在**真实数据**上的量级。
 *
 * 这是 REF-1c(切换 + key 重算迁移)的决策输入:
 * 换归一键会动匹配结果、要重算全表、还可能撞键 —— 先量出来再决定怎么迁。
 *
 * §4 纪律:**只输出聚合计数**,maxExamples 一律传 0,零真实值进日志/断言消息。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMainSheet } from "@/lib/integration/erp/sources/kingdee/excel/workbook";
import { QIANCHUANG_K3_V1, detectRole, type FileRole } from "@/lib/integration/erp/profiles/qianchuang-k3-v1";
import {
  compareManufacturerKeyRules,
  compareMpnKeyRules,
  LEGACY_MANUFACTURER_RULES,
  newCollisionsVsLegacy,
  summarizeDivergence,
} from "@/modules/parts/domain/rule-divergence";
import { manufacturerKey } from "@/modules/parts/domain/manufacturer-registry";

const dir = process.env.QIANCHUANG_UAT_FIXTURE_DIR!;

async function loadSheet(role: FileRole) {
  const f = readdirSync(dir).find((x) => x.endsWith(".xlsx") && detectRole(QIANCHUANG_K3_V1, x) === role);
  expect(f, `缺少角色文件 ${role}`).toBeTruthy();
  return parseMainSheet(readFileSync(path.join(dir, f!)));
}

function uniqueColumn(rows: { cells: Record<string, string> }[], col: string): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = (r.cells[col] ?? "").trim();
    if (v) set.add(v);
  }
  return [...set];
}

describe("REF-1a:真实 MFG 数据上的归一规则差异", () => {
  it("MPN 键:canonical 与 A1(库内存量口径)**零差异**,与四条 ASCII 规则有实测差异", async () => {
    const sheet = await loadSheet("MATERIAL_MFG");
    const mpns = uniqueColumn(sheet.rows, "MFG_PN");
    expect(mpns.length).toBeGreaterThan(1000);

    const report = compareMpnKeyRules(mpns, 0); // maxExamples=0:不留任何真实值
    // 聚合摘要可以安全打印 —— 只有规则名与计数
    console.log("[REF-1a] MPN 键差异(唯一值 " + mpns.length + " 条):\n  " +
      summarizeDivergence(report).join("\n  "));

    const a1 = report.rules.find((r) => r.ruleId === "A1")!;
    // **关键事实**:canonical 就是 A1 的规则,而 A1 是库内 manufacturerPartNoKey
    // 与迁移 r4_3 的口径 → 采纳 canonical 不需要重算该列。
    expect(a1.differing).toBe(0);

    // 四条 ASCII 规则在真实数据上确有差异(510 条含非 ASCII 的那批)
    const asciiDiff = ["A2", "A3", "A4", "A5"].map(
      (id) => report.rules.find((r) => r.ruleId === id)!.differing,
    );
    expect(Math.min(...asciiDiff)).toBeGreaterThan(0);
    // 任何一条示例都不许进报告
    expect(report.rules.every((r) => r.examples.length === 0)).toBe(true);
  });

  it("厂商键:canonical 与库内存量 B4 的差异量与撞键组数(REF-1c 迁移规模)", async () => {
    const sheet = await loadSheet("MATERIAL_MFG");
    const mfrs = uniqueColumn(sheet.rows, "MFG");
    expect(mfrs.length).toBeGreaterThan(500);

    const report = compareManufacturerKeyRules(mfrs, 0);
    console.log("[REF-1a] 厂商键差异(唯一值 " + mfrs.length + " 条):\n  " +
      summarizeDivergence(report).join("\n  "));
    console.log(
      "[REF-1a] canonical 撞键组数 " + report.canonicalCollisions.length +
        ",涉及原值 " + report.canonicalCollisions.reduce((n, c) => n + c.samples.length, 0) + " 条",
    );

    // **真正的迁移风险量**:旧规则下各自独立、canonical 下撞在一起的组。
    // 这些会违反 ManufacturerAlias.normalizedAlias 的唯一约束,迁移必须先合并。
    const b4Rule = LEGACY_MANUFACTURER_RULES.find((r) => r.id === "B4")!;
    const newly = newCollisionsVsLegacy(mfrs, b4Rule, manufacturerKey);
    console.log(
      "[REF-1a] **新增**撞键组(旧 B4 下不同键、canonical 下同键):" +
        newly.length + " 组,涉及原值 " + newly.reduce((n, c) => n + c.count, 0) + " 条",
    );
    for (const c of newly) expect(c.legacyKeys.length).toBeGreaterThan(1);

    const b4 = report.rules.find((r) => r.ruleId === "B4")!;
    // canonical 额外剥公司后缀 → 与存量键不同,**这就是必须做重算迁移的原因**
    expect(b4.differing).toBeGreaterThan(0);
    expect(report.rules.every((r) => r.examples.length === 0)).toBe(true);

    // 撞键组要么为 0,要么每组至少 2 条 —— 结构自检,防止报告本身算错
    for (const c of report.canonicalCollisions) {
      expect(c.samples.length).toBeGreaterThanOrEqual(2);
    }
  });
});
