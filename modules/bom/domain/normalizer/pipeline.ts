/**
 * REF-2c:BOM 标准化管线 V2(`BOM_NORMALIZER_V2`)。
 *
 * 与 V1(lib/domain/bom-parse.ts `toStandardLinesTraced`)**输出逐字段相同**,
 * 区别只在结构:逐行判定拆成 stages.ts 里的具名阶段,顺序在这里显式写出;
 * 自校准额外报告两种解析各自的吻合率,供界面解释"为什么合并/没合并"。
 *
 * 每一行按下列顺序**恰好**落到一个去向(账本恒等式的来源):
 *   1. 空行 / 翻页重复表头            → BLANK / REPEATED_HEADER
 *   2. 上一行位号未列全的位号折行      → MERGED_INTO_PREVIOUS(仅合并模式)
 *   3. 无键行:页脚 / 描述折行 / 其它   → PAGE_FOOTER / MERGED_INTO_PREVIOUS / NO_IDENTIFIER
 *   4. 只有位号、其余全空             → INSUFFICIENT
 *   5. 其余                           → RECOGNIZED(成行,MPN 决议)
 */
import { referenceCount } from "@/modules/bom/domain/reference-designator";
import {
  appendDescription,
  buildLine,
  classifyKeyless,
  classifyNonBusiness,
  hasKey,
  headerKeyOf,
  isInsufficient,
  isReferenceContinuation,
  mergeReferenceContinuation,
  readRowCells,
  type BomMapping,
} from "./stages";
import type { ParsedBomLine, RowDisposition, RowTrace } from "./types";

export interface NormalizeResult {
  lines: ParsedBomLine[];
  trace: RowTrace[];
}

export interface NormalizeOptions {
  /** 是否启用位号续行合并(自校准会两种都跑) */
  mergeContinuations: boolean;
}

/** 单遍:按固定顺序把每一行落到一个去向 */
export function normalizeRows(
  rows: readonly (readonly string[])[],
  mapping: BomMapping,
  opts: NormalizeOptions,
): NormalizeResult {
  const lines: ParsedBomLine[] = [];
  const trace: RowTrace[] = [];
  const headerKey = headerKeyOf(rows, mapping);

  const mark = (
    r: number,
    disposition: RowDisposition,
    reason: string,
    extra: { lineNo?: number; mergedIntoSourceRow?: number } = {},
  ) =>
    trace.push({
      sourceRow: r + 1,
      disposition,
      reason,
      lineNo: extra.lineNo ?? null,
      mergedIntoSourceRow: extra.mergedIntoSourceRow ?? null,
      cells: (rows[r] ?? []).map((c) => (c ?? "").trim()),
    });

  for (let r = mapping.headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];

    const nonBusiness = classifyNonBusiness(row, headerKey);
    if (nonBusiness) {
      mark(r, nonBusiness.disposition, nonBusiness.reason);
      continue;
    }

    const cells = readRowCells(row, mapping);
    const prev = lines.length > 0 ? lines[lines.length - 1] : null;

    if (opts.mergeContinuations && prev && isReferenceContinuation(prev, cells)) {
      lines[lines.length - 1] = mergeReferenceContinuation(prev, cells);
      mark(r, "MERGED_INTO_PREVIOUS", `位号折行,已并入第 ${prev.sourceRow} 行(该行数量 ${prev.qty},位号尚未列全)`, {
        mergedIntoSourceRow: prev.sourceRow,
      });
      continue;
    }

    if (!hasKey(cells)) {
      const k = classifyKeyless(cells, prev !== null);
      if (k.kind === "PAGE_FOOTER") {
        mark(r, "PAGE_FOOTER", "识别为页脚(如 Page 1 of 3)");
      } else if (k.kind === "DESCRIPTION_FRAGMENT" && prev) {
        lines[lines.length - 1] = appendDescription(prev, cells.description!);
        mark(r, "MERGED_INTO_PREVIOUS", `描述折行,已并入第 ${prev.sourceRow} 行的描述`, {
          mergedIntoSourceRow: prev.sourceRow,
        });
      } else {
        mark(r, "NO_IDENTIFIER", "既无 MPN / 客户料号 / 内部料号,也无位号 —— 无法判定是不是物料行");
      }
      continue;
    }

    if (isInsufficient(cells)) {
      mark(r, "INSUFFICIENT", "只有位号一列有值,其余全空 —— 更像附注而不是物料行");
      continue;
    }

    const lineNo = lines.length + 1;
    mark(r, "RECOGNIZED", "已识别为物料行", { lineNo });
    lines.push(buildLine(r + 1, lineNo, cells));
  }

  return { lines, trace };
}

/**
 * 「位号数 == 数量」的吻合率。
 * 用它来客观判断某个解析选择是不是更接近原表,而不是靠猜。
 */
export function referenceAgreement(lines: readonly ParsedBomLine[]): number {
  const solid = lines.filter((l) => l.qty !== null && l.refDes);
  if (solid.length === 0) return 0;
  return solid.filter((l) => referenceCount(l.refDes) === l.qty).length / solid.length;
}

export interface Calibration {
  /** 采用了哪一种解析 */
  mode: "MERGED" | "PLAIN";
  plainAgreement: number;
  mergedAgreement: number;
}

/**
 * 自校准:两种解析都算一遍,取吻合率**严格更高**者;打平不合并 ——
 * 很多 BOM 的数量根本不等于位号数,那里合并就是错的,不确定就别动原始数据。
 * 采用哪一种,就用哪一种的 trace,账才对得上。
 */
export function normalizeBom(
  rows: readonly (readonly string[])[],
  mapping: BomMapping,
): NormalizeResult & { calibration: Calibration } {
  const plain = normalizeRows(rows, mapping, { mergeContinuations: false });
  const merged = normalizeRows(rows, mapping, { mergeContinuations: true });
  const plainAgreement = referenceAgreement(plain.lines);
  const mergedAgreement = referenceAgreement(merged.lines);
  const useMerged = mergedAgreement > plainAgreement;
  return {
    ...(useMerged ? merged : plain),
    calibration: { mode: useMerged ? "MERGED" : "PLAIN", plainAgreement, mergedAgreement },
  };
}
