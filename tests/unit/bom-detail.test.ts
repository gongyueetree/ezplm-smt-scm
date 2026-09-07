/**
 * F7:BOM 详情页的 KPI 口径与批量确认资格(纯函数)。
 * 核心不变量:相似度来源永不进批量确认;NO_MATCH 不混入未识别;阈值来自参数不硬编码。
 */
import { describe, expect, it } from "vitest";
import {
  deriveBomKpis,
  eligibleForBulkConfirm,
  isManufacturingInfoEmpty,
  ManufacturingInfoSchema,
  type BomKpiLine,
} from "@/lib/domain/bom-detail";
import { buildCompareExportRows } from "@/lib/domain/bom-compare";
import { compareBomVersions } from "@/lib/domain/bom-compare";
import type { ParsedBomLine } from "@/lib/domain/bom-parse";

const line = (
  id: string,
  decision: BomKpiLine["decision"],
  candidates: { source: string; confidence: number }[],
): BomKpiLine => ({ id, decision, candidates });

describe("deriveBomKpis", () => {
  it("五类行各归各位:已匹配 / 需确认 / 未识别 / 已确认无匹配 / 可批量", () => {
    const kpis = deriveBomKpis(
      [
        line("a", "ACCEPT_CANDIDATE", [{ source: "EXACT_MPN", confidence: 0.98 }]),
        line("b", "MANUAL_ASSIGN", []),
        line("c", "NO_MATCH", []),
        line("d", null, []), // 未识别
        line("e", null, [{ source: "EXACT_MPN", confidence: 0.7 }]), // 需确认(低于阈值)
        line("f", null, [{ source: "EXACT_MPN", confidence: 0.95 }]), // 可批量
      ],
      0.9,
    );
    expect(kpis.totalLines).toBe(6);
    expect(kpis.matched).toBe(2);
    expect(kpis.confirmedNoMatch).toBe(1);
    expect(kpis.unrecognized).toBe(1);
    expect(kpis.needsReview).toBe(1);
    expect(kpis.batchEligible).toBe(1);
    expect(kpis.matchRate).toBeCloseTo(2 / 6);
  });

  it("相似度来源即使 100% 也归入需人工确认,不进可批量", () => {
    const kpis = deriveBomKpis([line("x", null, [{ source: "LOCAL_SIMILAR", confidence: 1 }])], 0.9);
    expect(kpis.batchEligible).toBe(0);
    expect(kpis.needsReview).toBe(1);
  });

  it("空 BOM 的匹配率是 null(显示 —),不是 100%", () => {
    expect(deriveBomKpis([], 0.9).matchRate).toBeNull();
  });

  it("阈值变化直接改变分类 —— 证明没有硬编码", () => {
    const rows = [line("x", null, [{ source: "EXACT_MPN", confidence: 0.85 }])];
    expect(deriveBomKpis(rows, 0.9).needsReview).toBe(1);
    expect(deriveBomKpis(rows, 0.8).batchEligible).toBe(1);
  });
});

describe("eligibleForBulkConfirm(服务端复核用同一函数)", () => {
  it("已决/无候选/相似度来源/低置信度 → 各给出人话原因", () => {
    expect(eligibleForBulkConfirm(line("a", "NO_MATCH", []), 0.9).reason).toContain("已有人工决定");
    expect(eligibleForBulkConfirm(line("b", null, []), 0.9).reason).toBe("无候选");
    expect(
      eligibleForBulkConfirm(line("c", null, [{ source: "DESCRIPTION", confidence: 0.99 }]), 0.9)
        .reason,
    ).toContain("相似度来源");
    expect(
      eligibleForBulkConfirm(line("d", null, [{ source: "EXACT_MPN", confidence: 0.5 }]), 0.9).reason,
    ).toContain("低于阈值");
    expect(
      eligibleForBulkConfirm(line("e", null, [{ source: "EXACT_MPN", confidence: 0.95 }]), 0.9)
        .eligible,
    ).toBe(true);
  });
});

describe("差异导出复用同一 diff 函数(spec §9 验收点)", () => {
  const parsed = (lineNo: number, refDes: string, mpn: string, qty: number): ParsedBomLine => ({
    sourceRow: lineNo,
    lineNo,
    refDes,
    qty,
    mpn,
    manufacturer: "M",
    customerPn: null,
    internalPn: null,
    description: null,
    footprint: null,
    issues: [],
  });

  it("导出行直接由 compareBomVersions 输出构建,汇总口径一致", () => {
    const before = [parsed(1, "R1", "A", 2), parsed(2, "C1", "B", 1)];
    const after = [parsed(1, "R1", "A", 4), parsed(2, "D1", "C", 1)];
    const { entries, summary } = compareBomVersions(before, after);
    const rows = buildCompareExportRows(entries);
    // 默认不含未变化行;总行数 = 各类变更之和
    expect(rows.length).toBe(summary.added + summary.removed + summary.qtyChanged + summary.partChanged);
    const qtyRow = rows.find((r) => r.type === "qty_changed");
    expect(qtyRow?.beforeQty).toBe("2");
    expect(qtyRow?.afterQty).toBe("4");
    // includeUnchanged 时把 unchanged 也带上
    expect(buildCompareExportRows(entries, { includeUnchanged: true }).length).toBe(entries.length);
  });
});

describe("ManufacturingInfoSchema", () => {
  it("节拍未知留 null,不接受 0 冒充;空表单是合法的空态", () => {
    const parsed = ManufacturingInfoSchema.parse({
      processRoute: [{ seq: 1, process: "SMT 贴片", taktSeconds: null }],
    });
    expect(parsed.processRoute[0].taktSeconds).toBeNull();
    expect(ManufacturingInfoSchema.safeParse({ processRoute: [{ seq: 1, process: "X", taktSeconds: 0 }] }).success).toBe(false);
    expect(isManufacturingInfoEmpty(ManufacturingInfoSchema.parse({}))).toBe(true);
  });
});
