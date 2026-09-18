/**
 * REF-2c 管线 · 逐行判定的各个阶段(纯函数,可单独测试)。
 *
 * V1(lib/domain/bom-parse.ts `buildLines`)把这些判定写在一个 180 行的循环体里,
 * 规则之间靠语句顺序隐式排优先级。这里把每条规则拆成一个具名函数,
 * 顺序由 pipeline.ts 显式编排 —— **规则本身逐字未改**,改的只是结构;
 * 等价性由对拍证明(tests/golden/bom-normalizer-v2.golden.test.ts)。
 */
import { cellText, type MappingResult } from "@/modules/tabular/domain/column-mapping";
import { looksLikeReferenceList, referenceCount } from "@/modules/bom/domain/reference-designator";
import { inferMpnFromValue, parseKicadFootprint } from "@/lib/domain/kicad-value";
import { isPageFooter, looksLikeMpnCell, parseQty } from "./cells";
import type { BomField, MpnSource, ParsedBomLine, RowDisposition } from "./types";

export type BomMapping = MappingResult<BomField>;

/* ---------------- 阶段 1:读格 ---------------- */

/** 一行按映射读出来的全部单元格(已过数量解析与 MPN 守卫) */
export interface RowCells {
  rawQty: string | null;
  qty: number | null;
  qtyIssue: string | undefined;
  qtyNotice: string | undefined;
  /** 过了 `looksLikeMpnCell` 守卫的 MPN(整段正文落进料号列时为 null) */
  mpn: string | null;
  customerPn: string | null;
  internalPn: string | null;
  description: string | null;
  refDes: string | null;
  footprint: string | null;
  manufacturer: string | null;
}

export function readRowCells(row: readonly string[], mapping: BomMapping): RowCells {
  const rawQty = cellText(row, mapping.fields.qty);
  const { qty, issue, notice } = parseQty(rawQty);
  const mpnCell = cellText(row, mapping.fields.mpn);
  return {
    rawQty,
    qty,
    qtyIssue: issue,
    qtyNotice: notice,
    mpn: looksLikeMpnCell(mpnCell) ? mpnCell : null,
    customerPn: cellText(row, mapping.fields.customerPn),
    internalPn: cellText(row, mapping.fields.internalPn),
    description: cellText(row, mapping.fields.description),
    refDes: cellText(row, mapping.fields.refDes),
    footprint: cellText(row, mapping.fields.footprint),
    manufacturer: cellText(row, mapping.fields.manufacturer),
  };
}

/* ---------------- 阶段 2:非业务行 ---------------- */

const rowKey = (row: readonly string[]) => row.map((c) => (c ?? "").trim().toUpperCase()).join("");

/** 表头行的比对键(大小写与首尾空白不敏感) */
export function headerKeyOf(rows: readonly (readonly string[])[], mapping: BomMapping): string {
  return rowKey(rows[mapping.headerRowIndex] ?? []);
}

export interface Verdict {
  disposition: RowDisposition;
  reason: string;
}

/**
 * 空行 / 翻页重复表头。
 * 多页 PDF 每页都会重复一次表头;buildPdfTable 只能与"第一行"比对,
 * 而表格上方常有标题块,所以按识别出来的表头再挡一次。
 */
export function classifyNonBusiness(row: readonly string[], headerKey: string): Verdict | null {
  if (row.every((c) => (c ?? "").trim() === "")) return { disposition: "BLANK", reason: "整行没有任何内容" };
  if (rowKey(row) === headerKey) {
    return { disposition: "REPEATED_HEADER", reason: "与表头完全一致 —— 多页文件每页都会重复一次表头" };
  }
  return null;
}

/* ---------------- 阶段 3:位号续行 ---------------- */

/**
 * 上一行是否"还差位号":声明了数量,已列位号数 > 0 且 < 数量。
 * 这是续行合并的关键判据 —— 比"看起来像续行"可靠得多。
 */
export function expectsMoreReferences(prev: ParsedBomLine | null): boolean {
  if (prev === null || prev.qty === null) return false;
  const n = referenceCount(prev.refDes);
  return n > 0 && n < prev.qty;
}

/** 本行是否为上一行的位号折行(只有位号串、没有数量与任何料号/厂商) */
export function isReferenceContinuation(prev: ParsedBomLine | null, c: RowCells): boolean {
  return (
    expectsMoreReferences(prev) &&
    c.qty === null &&
    !c.mpn &&
    !c.customerPn &&
    !c.internalPn &&
    !c.manufacturer &&
    Boolean(c.refDes) &&
    looksLikeReferenceList(c.refDes)
  );
}

/** 把位号折行并进上一行:位号拼接;描述/封装只补空位、不覆盖 */
export function mergeReferenceContinuation(prev: ParsedBomLine, c: RowCells): ParsedBomLine {
  return {
    ...prev,
    refDes: [prev.refDes, c.refDes].filter(Boolean).join(" "),
    description: c.description && !prev.description ? c.description : prev.description,
    footprint: c.footprint && !prev.footprint ? c.footprint : prev.footprint,
  };
}

/* ---------------- 阶段 4:无键行 ---------------- */

/** 有没有"键":位号或任一料号。只有描述的行不是物料行 */
export function hasKey(c: RowCells): boolean {
  return Boolean(c.mpn || c.customerPn || c.internalPn || c.refDes);
}

export type KeylessOutcome =
  | { kind: "PAGE_FOOTER" }
  /** 描述折行:并回上一行的描述,避免白丢信息 */
  | { kind: "DESCRIPTION_FRAGMENT" }
  | { kind: "NO_IDENTIFIER" };

/** 无键行的去向:页脚 > 描述折行(须有上一行)> 待人工 */
export function classifyKeyless(c: RowCells, hasPreviousLine: boolean): KeylessOutcome {
  if (c.description && isPageFooter(c.description)) return { kind: "PAGE_FOOTER" };
  if (c.description && hasPreviousLine) return { kind: "DESCRIPTION_FRAGMENT" };
  return { kind: "NO_IDENTIFIER" };
}

export function appendDescription(prev: ParsedBomLine, description: string): ParsedBomLine {
  return { ...prev, description: [prev.description, description].filter(Boolean).join(" ") };
}

/* ---------------- 阶段 5:信息量 ---------------- */

/**
 * 只有位号、其余全空 —— 更像附注("备注:以上为主料"落在第一列)。
 * 工程侧 BOM 常只有 位号/数量/Value/封装,所以"有位号 + 任一其它列"就算物料行;
 * 据此区分,不靠猜文案。
 */
export function isInsufficient(c: RowCells): boolean {
  const hasIdentifier = Boolean(c.mpn || c.customerPn || c.internalPn || c.description);
  const otherFilled = [c.rawQty, c.manufacturer, c.footprint].filter(Boolean).length;
  return !hasIdentifier && !(c.refDes && otherFilled > 0);
}

/* ---------------- 阶段 6:MPN 决议 ---------------- */

export interface MpnResolution {
  mpn: string | null;
  source: MpnSource | null;
  notice: string | null;
}

/**
 * 有 MPN 列用列;没有则尝试从 Value 认型号(KiCad 的 IC 的 Value 就是型号)。
 * 推断结果标记来源,**必须人工确认**。
 */
export function resolveMpn(c: RowCells): MpnResolution {
  if (c.mpn) return { mpn: c.mpn, source: "column", notice: null };
  const inferred = inferMpnFromValue({ value: c.description, refDes: c.refDes });
  if (inferred) return { mpn: inferred.mpn, source: "inferred-from-value", notice: inferred.reason };
  return { mpn: null, source: null, notice: null };
}

/* ---------------- 阶段 7:成行 ---------------- */

export function buildLine(sourceRow: number, lineNo: number, c: RowCells): ParsedBomLine {
  const issues: string[] = [];
  const notices: string[] = [];
  if (c.qtyIssue) issues.push(c.qtyIssue);
  if (c.qtyNotice) notices.push(c.qtyNotice);

  const m = resolveMpn(c);
  if (m.notice) notices.push(m.notice);
  if (!m.mpn && !c.customerPn && !c.internalPn) issues.push("缺少 MPN / 客户料号 / 内部料号,无法匹配");

  return {
    sourceRow,
    lineNo,
    refDes: c.refDes,
    qty: c.qty,
    mpn: m.mpn,
    manufacturer: c.manufacturer,
    customerPn: c.customerPn,
    internalPn: c.internalPn,
    description: c.description,
    footprint: c.footprint,
    mpnSource: m.source,
    packageCode: parseKicadFootprint(c.footprint)?.packageCode ?? null,
    issues,
    notices,
  };
}
