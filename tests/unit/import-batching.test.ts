import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATCH_SIZE,
  IMPORT_JOB_THRESHOLD,
  MAX_BATCH_SIZE,
  MIN_BATCH_SIZE,
  computeProgress,
  nextBatchSlice,
  normalizeBatchSize,
  shouldUseImportJob,
  splitIntoBatches,
} from "@/lib/domain/import-batching";
import { compareBomVersions } from "@/lib/domain/bom-compare";
import type { ParsedBomLine } from "@/lib/domain/bom-parse";

describe("大 BOM 分批(SPEC §15)", () => {
  it("阈值与批大小区间符合 SPEC:>50 走 Job,每批 10–20", () => {
    expect(IMPORT_JOB_THRESHOLD).toBe(50);
    expect(MIN_BATCH_SIZE).toBe(10);
    expect(MAX_BATCH_SIZE).toBe(20);
    expect(shouldUseImportJob(50)).toBe(false);
    expect(shouldUseImportJob(51)).toBe(true);
  });

  it("批大小被夹到 [10,20],非法值回落默认", () => {
    expect(normalizeBatchSize(5)).toBe(MIN_BATCH_SIZE);
    expect(normalizeBatchSize(100)).toBe(MAX_BATCH_SIZE);
    expect(normalizeBatchSize(15)).toBe(15);
    expect(normalizeBatchSize(undefined)).toBe(DEFAULT_BATCH_SIZE);
    expect(normalizeBatchSize(Number.NaN)).toBe(DEFAULT_BATCH_SIZE);
  });

  it("切分覆盖全部元素且不产生空批", () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    const batches = splitIntoBatches(items, 20);
    expect(batches.map((b) => b.length)).toEqual([20, 20, 5]);
    expect(batches.flat()).toEqual(items);
    expect(splitIntoBatches([], 20)).toEqual([]);
  });

  it("240 唯一 MPN 时批数符合预期(禁止单请求处理整张 BOM)", () => {
    const items = Array.from({ length: 240 }, (_, i) => `MPN-${i}`);
    const batches = splitIntoBatches(items, 20);
    expect(batches).toHaveLength(12);
    expect(batches.every((b) => b.length <= MAX_BATCH_SIZE)).toBe(true);
  });

  it("进度计算:边界安全、百分比 1 位小数", () => {
    expect(computeProgress(200, 0)).toMatchObject({ percent: 0, done: false, remaining: 200 });
    expect(computeProgress(200, 50)).toMatchObject({ percent: 25, done: false });
    expect(computeProgress(3, 1).percent).toBe(33.3);
    expect(computeProgress(200, 200)).toMatchObject({ percent: 100, done: true, remaining: 0 });
    // 越界输入被夹住,不会出现 >100% 或负数
    expect(computeProgress(10, 999)).toMatchObject({ percent: 100, done: true });
    expect(computeProgress(10, -5).processed).toBe(0);
    expect(computeProgress(0, 0)).toMatchObject({ percent: 100, done: true });
  });

  it("拉取式分批:逐批推进直到结束", () => {
    const total = 45;
    let processed = 0;
    const slices: { start: number; end: number }[] = [];
    for (;;) {
      const s = nextBatchSlice(total, processed, 20);
      if (!s) break;
      slices.push(s);
      processed = s.end;
    }
    expect(slices).toEqual([
      { start: 0, end: 20 },
      { start: 20, end: 40 },
      { start: 40, end: 45 },
    ]);
    expect(nextBatchSlice(total, total, 20)).toBeNull();
  });
});

function line(patch: Partial<ParsedBomLine>): ParsedBomLine {
  return {
    sourceRow: 1,
    lineNo: 1,
    refDes: null,
    qty: 1,
    mpn: null,
    manufacturer: null,
    customerPn: null,
    internalPn: null,
    description: null,
    footprint: null,
    issues: [],
    ...patch,
  };
}

describe("BOM 版本比对(SPEC §6)", () => {
  const v1 = [
    line({ lineNo: 1, refDes: "R1", qty: 1, mpn: "RC0603FR-0710KL", manufacturer: "Yageo" }),
    line({ lineNo: 2, refDes: "C1", qty: 2, mpn: "GRM188R71H104KA93D", manufacturer: "Murata" }),
    line({ lineNo: 3, refDes: "U1", qty: 1, mpn: "MAX232CPE", manufacturer: "Analog Devices" }),
  ];
  const v2 = [
    line({ lineNo: 1, refDes: "R1", qty: 1, mpn: "RC0603FR-0710KL", manufacturer: "Yageo" }),
    line({ lineNo: 2, refDes: "C1", qty: 4, mpn: "GRM188R71H104KA93D", manufacturer: "Murata" }),
    line({ lineNo: 3, refDes: "U1", qty: 1, mpn: "MAX3232EIDR", manufacturer: "Texas Instruments" }),
    line({ lineNo: 4, refDes: "D1", qty: 1, mpn: "1N4148W", manufacturer: "Vishay" }),
  ];

  it("识别新增/数量变更/料号变更,并汇总计数", () => {
    const { entries, summary } = compareBomVersions(v1, v2);
    expect(summary).toEqual({
      added: 1,
      removed: 0,
      qtyChanged: 1,
      partChanged: 1,
      unchanged: 1,
    });
    const byType = Object.fromEntries(entries.map((e) => [e.type, e]));
    expect(byType.added.after?.mpn).toBe("1N4148W");
    expect(byType.qty_changed.changes.join()).toContain("数量变更:2 → 4");
    expect(byType.part_changed.changes.join()).toContain("MAX232CPE");
  });

  it("删除行被识别", () => {
    const { summary } = compareBomVersions(v2, v1);
    expect(summary.removed).toBe(1);
    expect(summary.added).toBe(0);
  });

  it("以位号为主键:行序变化不产生差异", () => {
    const shuffled = [...v1].reverse();
    const { summary } = compareBomVersions(v1, shuffled);
    expect(summary).toMatchObject({ added: 0, removed: 0, qtyChanged: 0, partChanged: 0 });
    expect(summary.unchanged).toBe(3);
  });

  it("无位号时退化为按料号比对", () => {
    const a = [line({ lineNo: 1, refDes: null, qty: 1, mpn: "AAA" })];
    const b = [line({ lineNo: 9, refDes: null, qty: 3, mpn: "AAA" })];
    const { summary } = compareBomVersions(a, b);
    expect(summary.qtyChanged).toBe(1);
  });

  it("空版本对比:全部视为新增/删除", () => {
    expect(compareBomVersions([], v1).summary.added).toBe(3);
    expect(compareBomVersions(v1, []).summary.removed).toBe(3);
    expect(compareBomVersions([], []).entries).toEqual([]);
  });
});
