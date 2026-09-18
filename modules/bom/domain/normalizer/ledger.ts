/**
 * REF-2c 管线 · 账本阶段:导入行去向对账(Round2 沉淀纪律 3 的恒等式)。
 *
 * 从 lib/domain/bom-parse.ts 原样迁来(bom-parse 继续转出),V1 与 V2 共用。
 */
import {
  NEEDS_REVIEW_DISPOSITIONS,
  NON_BUSINESS_DISPOSITIONS,
  type ParsedBomLine,
  type RowDisposition,
  type RowTrace,
} from "./types";

export interface ImportReconciliation {
  /** 表头之后的原始行数 —— 对账的分母 */
  totalRows: number;
  recognized: number;
  mergedIntoPrevious: number;
  /** 空行 / 重复表头 / 页脚 */
  nonBusiness: number;
  /** 需要人工看一眼的行(**这就是以前被悄悄丢掉的那部分**) */
  needsReview: number;
  /** 已识别但带解析问题的行(数量非法等)—— 它们仍算 recognized */
  withIssues: number;
  byDisposition: Record<RowDisposition, number>;
  /**
   * 账平不平:`totalRows === recognized + merged + nonBusiness + needsReview`。
   * 为 false 说明解析器里有一条路径没有登记去向 —— 这是**代码缺陷**,
   * 界面必须报出来,不能当没看见。
   */
  balanced: boolean;
}

/**
 * 导入行去向对账(客户 Q13 的验收口径)。
 *
 * 空行与重复表头**计入 totalRows**,单列一类。
 * 先偷偷减掉空行再对账,对账本身就成了新的黑洞 ——
 * 客户要的恰恰是"每一行都有去向"。
 */
export function reconcileImport(
  trace: readonly RowTrace[],
  lines: readonly ParsedBomLine[],
): ImportReconciliation {
  const byDisposition = {
    RECOGNIZED: 0,
    MERGED_INTO_PREVIOUS: 0,
    BLANK: 0,
    REPEATED_HEADER: 0,
    PAGE_FOOTER: 0,
    NO_IDENTIFIER: 0,
    INSUFFICIENT: 0,
  } as Record<RowDisposition, number>;
  for (const t of trace) byDisposition[t.disposition] += 1;

  const nonBusiness = NON_BUSINESS_DISPOSITIONS.reduce((n, d) => n + byDisposition[d], 0);
  const needsReview = NEEDS_REVIEW_DISPOSITIONS.reduce((n, d) => n + byDisposition[d], 0);
  const recognized = byDisposition.RECOGNIZED;
  const mergedIntoPrevious = byDisposition.MERGED_INTO_PREVIOUS;

  return {
    totalRows: trace.length,
    recognized,
    mergedIntoPrevious,
    nonBusiness,
    needsReview,
    withIssues: lines.filter((l) => l.issues.length > 0).length,
    byDisposition,
    balanced: trace.length === recognized + mergedIntoPrevious + nonBusiness + needsReview,
  };
}
