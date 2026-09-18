/**
 * REF-2c:BOM 标准化管线各阶段的直接单测。
 *
 * V1 里这些规则全埋在一个循环体里,只能透过整张表间接测;拆开后每条规则单独可测。
 * 整体等价性见 tests/golden/bom-normalizer-v2.golden.test.ts。
 */
import { describe, expect, it } from "vitest";
import {
  classifyKeyless,
  classifyNonBusiness,
  expectsMoreReferences,
  headerKeyOf,
  isInsufficient,
  isReferenceContinuation,
  mergeReferenceContinuation,
  readRowCells,
  resolveMpn,
  buildLine,
  type BomMapping,
  type RowCells,
} from "@/modules/bom/domain/normalizer/stages";
import { normalizeBom, normalizeRows, referenceAgreement } from "@/modules/bom/domain/normalizer/pipeline";
import { reconcileImport } from "@/modules/bom/domain/normalizer/ledger";
import type { ParsedBomLine } from "@/modules/bom/domain/normalizer/types";
import { isRefactorFlagOn } from "@/lib/domain/refactor-flags";

const mapping: BomMapping = {
  fields: { refDes: 0, qty: 1, mpn: 2, manufacturer: 3, description: 4, footprint: 5 },
  headerRowIndex: 0,
  unmapped: [],
  confidence: 1,
};
const HEADER = ["位号", "数量", "MPN", "制造商", "描述", "封装"];

const cells = (over: Partial<RowCells> = {}): RowCells => ({
  rawQty: null,
  qty: null,
  qtyIssue: undefined,
  qtyNotice: undefined,
  mpn: null,
  customerPn: null,
  internalPn: null,
  description: null,
  refDes: null,
  footprint: null,
  manufacturer: null,
  ...over,
});

const line = (over: Partial<ParsedBomLine> = {}): ParsedBomLine => ({
  sourceRow: 2,
  lineNo: 1,
  refDes: "C1, C2",
  qty: 4,
  mpn: "GRM188R71H104KA93D",
  manufacturer: null,
  customerPn: null,
  internalPn: null,
  description: null,
  footprint: null,
  issues: [],
  notices: [],
  ...over,
});

describe("读格", () => {
  it("数量解析与 MPN 守卫在读格时完成", () => {
    const c = readRowCells(["C1", "0", "These resources are subject to change without notice", "", "", ""], mapping);
    expect(c.qty).toBe(0);
    expect(c.qtyNotice).toMatch(/DNP/);
    expect(c.mpn).toBeNull(); // 正文落进料号列不当 MPN
  });

  it("日期落进数量列:qty=null 并带 issue", () => {
    const c = readRowCells(["C1", "2026/8/1", "X", "", "", ""], mapping);
    expect(c.qty).toBeNull();
    expect(c.qtyIssue).toMatch(/日期/);
  });
});

describe("非业务行", () => {
  const key = headerKeyOf([HEADER], mapping);
  it("空行(含只有空白的格)", () => {
    expect(classifyNonBusiness(["", "  "], key)?.disposition).toBe("BLANK");
  });
  it("翻页重复表头:大小写与首尾空白不敏感", () => {
    expect(classifyNonBusiness([" 位号 ", "数量", "mpn", "制造商", "描述", "封装"], key)?.disposition).toBe(
      "REPEATED_HEADER",
    );
  });
  it("普通行不是非业务行", () => {
    expect(classifyNonBusiness(["C1", "1"], key)).toBeNull();
  });
});

describe("位号续行", () => {
  it("上一行还差位号才算「期待续行」", () => {
    expect(expectsMoreReferences(line({ refDes: "C1, C2", qty: 4 }))).toBe(true);
    expect(expectsMoreReferences(line({ refDes: "R1-R10", qty: 10 }))).toBe(false); // 范围已展开够数
    expect(expectsMoreReferences(line({ refDes: null, qty: 4 }))).toBe(false);
    expect(expectsMoreReferences(line({ qty: null }))).toBe(false);
    expect(expectsMoreReferences(null)).toBe(false);
  });

  it("续行:只有位号串;带数量/料号/厂商的都不是", () => {
    const prev = line();
    expect(isReferenceContinuation(prev, cells({ refDes: "C3 C4" }))).toBe(true);
    expect(isReferenceContinuation(prev, cells({ refDes: "C3 C4", qty: 2 }))).toBe(false);
    expect(isReferenceContinuation(prev, cells({ refDes: "C3", mpn: "X" }))).toBe(false);
    expect(isReferenceContinuation(prev, cells({ refDes: "C3", manufacturer: "Murata" }))).toBe(false);
    expect(isReferenceContinuation(prev, cells({ refDes: "备注:以上为主料" }))).toBe(false);
  });

  it("合并:位号拼接,描述/封装只补空位,**不改原对象**", () => {
    const prev = line({ description: "原描述" });
    const merged = mergeReferenceContinuation(prev, cells({ refDes: "C3 C4", description: "新描述", footprint: "0603" }));
    expect(merged.refDes).toBe("C1, C2 C3 C4");
    expect(merged.description).toBe("原描述");
    expect(merged.footprint).toBe("0603");
    expect(prev.refDes).toBe("C1, C2");
  });
});

describe("无键行与信息量", () => {
  it("页脚 > 描述折行(须有上一行)> 待人工", () => {
    expect(classifyKeyless(cells({ description: "Page 2 of 3" }), true).kind).toBe("PAGE_FOOTER");
    expect(classifyKeyless(cells({ description: "X7R 10%" }), true).kind).toBe("DESCRIPTION_FRAGMENT");
    expect(classifyKeyless(cells({ description: "X7R 10%" }), false).kind).toBe("NO_IDENTIFIER");
    expect(classifyKeyless(cells({ manufacturer: "Murata" }), true).kind).toBe("NO_IDENTIFIER");
  });

  it("只有位号、其余全空 → 信息不足;位号 + 任一数量/厂商/封装 → 够", () => {
    expect(isInsufficient(cells({ refDes: "TP1" }))).toBe(true);
    expect(isInsufficient(cells({ refDes: "TP1", rawQty: "abc" }))).toBe(false); // 看原始格,不看解析结果
    expect(isInsufficient(cells({ refDes: "TP1", footprint: "0603" }))).toBe(false);
  });
});

describe("MPN 决议与成行", () => {
  it("有列用列;无列从 Value 推断 IC 型号并提示人工确认;无源件参数不推断", () => {
    expect(resolveMpn(cells({ mpn: "X1" }))).toEqual({ mpn: "X1", source: "column", notice: null });
    const ic = resolveMpn(cells({ description: "CH340E", refDes: "U1" }));
    expect(ic.source).toBe("inferred-from-value");
    expect(ic.notice).toBeTruthy();
    expect(resolveMpn(cells({ description: "10k", refDes: "R1" })).mpn).toBeNull();
  });

  it("issues/notices 顺序:数量问题在前", () => {
    const l = buildLine(5, 3, cells({ refDes: "C1", qtyIssue: "数量为空" }));
    expect(l.issues).toEqual(["数量为空", "缺少 MPN / 客户料号 / 内部料号,无法匹配"]);
    expect(l).toMatchObject({ sourceRow: 5, lineNo: 3 });
  });
});

describe("编排与自校准", () => {
  const rows = [
    HEADER,
    ["C1, C2", "4", "GRM188R71H104KA93D", "", "电容", ""],
    ["C3, C4", "", "", "", "", ""],
    ["", "", "", "", "Page 1 of 2", ""],
    ["", "", "", "", "", ""],
  ];

  it("每一行恰好一个去向,账本恒等式成立", () => {
    for (const mergeContinuations of [false, true]) {
      const r = normalizeRows(rows, mapping, { mergeContinuations });
      expect(r.trace).toHaveLength(rows.length - 1);
      expect(reconcileImport(r.trace, r.lines).balanced).toBe(true);
    }
  });

  it("合并模式吻合率更高 → 采用合并,并报告两种吻合率", () => {
    const r = normalizeBom(rows, mapping);
    expect(r.calibration).toEqual({ mode: "MERGED", plainAgreement: 0, mergedAgreement: 1 });
    expect(r.lines[0].refDes).toBe("C1, C2 C3, C4");
  });

  it("打平不合并 —— 不确定就别动原始数据", () => {
    const flat = [HEADER, ["R1", "10", "RC0603FR-0710KL", "", "", ""]];
    expect(normalizeBom(flat, mapping).calibration.mode).toBe("PLAIN");
    expect(referenceAgreement([])).toBe(0);
  });
});

describe("flag", () => {
  it("BOM_NORMALIZER_V2 默认关", () => {
    expect(isRefactorFlagOn("BOM_NORMALIZER_V2", {})).toBe(false);
    expect(isRefactorFlagOn("BOM_NORMALIZER_V2", { REFACTOR_BOM_NORMALIZER_V2: "1" })).toBe(true);
  });
});
