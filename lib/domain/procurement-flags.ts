/**
 * 物料报价异常处理闭环(CLAUDE.md 领域规则,三轮诊断的核心教训)。
 *
 * 五条铁律,本文件逐条以纯函数固化:
 * 1. 采购填价时**固化「原始异常集合」**(wasFlagged),此后不随阈值变化而增减;
 * 2. 处理结论**默认空**,逐项人工选,系统不预设;
 * 3. REQUOTE / 换货源 / 调价 必须带新价并**重过校验**;
 * 4. 换货源必须记录**新供应商 / 价格 / 币种 / MOQ / SPQ / LT / 报价时间**(缺一不可);
 * 5. PM 确认必须覆盖**全部原始异常行**(不按当前是否仍超线),流程状态用**未处理数**。
 */

export type FlagResolutionValue = "ACCEPT" | "REQUOTE" | "SWITCH_SOURCE" | "ADJUST_PRICE";

export type FlagReasonCode = "price_over_limit" | "lead_time_over_limit" | "currency_mismatch";

export interface FlagReason {
  code: FlagReasonCode;
  detail: string;
}

/** 一次报价的完整快照(换货源时必须整份重填) */
export interface QuoteSnapshot {
  supplierId: string;
  unitPrice: string;
  currency: string;
  moq: number | null;
  spq: number | null;
  leadTimeDays: number | null;
  /** ISO 时间串 */
  quotedAt: string;
}

export interface FlagThresholds {
  /** 比价币种;报价币种与之不同即为异常(系统不做汇率换算) */
  currency: string;
  /** 价格上限(同币种十进制字符串);null = 不校验 */
  maxUnitPrice?: string | null;
  /** 交期上限天数;null = 不校验 */
  maxLeadTimeDays?: number | null;
}

function toNum(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 校验一份报价是否异常(铁律 1 的判定器)。
 * 采购填价时调用一次并把结果固化进 wasFlagged / flagReasons;
 * 换货源与重报价时对**新价**再调用一次(铁律 3)。
 */
export function evaluateFlags(quote: QuoteSnapshot, thresholds: FlagThresholds): {
  flagged: boolean;
  reasons: FlagReason[];
} {
  const reasons: FlagReason[] = [];

  if (quote.currency.toUpperCase() !== thresholds.currency.toUpperCase()) {
    reasons.push({
      code: "currency_mismatch",
      detail: `报价币种 ${quote.currency} 与比价币种 ${thresholds.currency} 不一致(系统不做汇率换算)`,
    });
  }

  const price = toNum(quote.unitPrice);
  const limit = toNum(thresholds.maxUnitPrice ?? null);
  if (price !== null && limit !== null && price > limit) {
    reasons.push({
      code: "price_over_limit",
      detail: `单价 ${quote.unitPrice} 超过价格线 ${thresholds.maxUnitPrice}`,
    });
  }

  if (
    quote.leadTimeDays !== null &&
    thresholds.maxLeadTimeDays !== null &&
    thresholds.maxLeadTimeDays !== undefined &&
    quote.leadTimeDays > thresholds.maxLeadTimeDays
  ) {
    reasons.push({
      code: "lead_time_over_limit",
      detail: `交期 ${quote.leadTimeDays} 天超过交期线 ${thresholds.maxLeadTimeDays} 天`,
    });
  }

  return { flagged: reasons.length > 0, reasons };
}

/** 报价行的异常处理状态 */
export interface FlaggedLineState {
  lineId: string;
  /** 固化的原始异常标记(铁律 1);一旦为 true,永远进入 PM 确认范围 */
  wasFlagged: boolean;
  flagReasons: FlagReason[];
  /** 处理结论,默认 null(铁律 2) */
  resolution: FlagResolutionValue | null;
  resolutionNote?: string | null;
  /** REQUOTE / SWITCH_SOURCE / ADJUST_PRICE 后的新报价(铁律 3、4) */
  replacement?: QuoteSnapshot | null;
}

export type ResolutionError =
  | { code: "note_required"; message: string }
  | { code: "replacement_required"; message: string }
  | { code: "replacement_incomplete"; message: string; missing: string[] }
  | { code: "still_flagged"; message: string; reasons: FlagReason[] };

/**
 * 校验一行的处理结论是否成立(铁律 3、4)。
 * - ACCEPT:接受异常必须写明理由(否则异常等于被无声吞掉);
 * - REQUOTE / ADJUST_PRICE:必须给新价,且新价重过校验后不得仍然异常;
 * - SWITCH_SOURCE:必须给出完整新报价(供应商/价格/币种/MOQ/SPQ/LT/报价时间),
 *   且新价同样重过校验。
 */
export function validateResolution(
  state: FlaggedLineState,
  thresholds: FlagThresholds,
): { ok: boolean; errors: ResolutionError[] } {
  const errors: ResolutionError[] = [];
  if (!state.resolution) {
    return { ok: false, errors: [{ code: "note_required", message: "尚未选择处理结论" }] };
  }

  if (state.resolution === "ACCEPT") {
    if (!state.resolutionNote?.trim()) {
      errors.push({ code: "note_required", message: "接受异常必须写明理由" });
    }
    return { ok: errors.length === 0, errors };
  }

  const r = state.replacement;
  if (!r) {
    errors.push({
      code: "replacement_required",
      message: `${state.resolution} 必须提供新的报价数据`,
    });
    return { ok: false, errors };
  }

  if (state.resolution === "SWITCH_SOURCE") {
    // 铁律 4:换货源七要素缺一不可
    const missing: string[] = [];
    if (!r.supplierId?.trim()) missing.push("新供应商");
    if (!r.unitPrice?.trim()) missing.push("价格");
    if (!r.currency?.trim()) missing.push("币种");
    if (r.moq === null || r.moq === undefined) missing.push("MOQ");
    if (r.spq === null || r.spq === undefined) missing.push("SPQ");
    if (r.leadTimeDays === null || r.leadTimeDays === undefined) missing.push("Lead Time");
    if (!r.quotedAt?.trim()) missing.push("报价时间");
    if (missing.length > 0) {
      errors.push({
        code: "replacement_incomplete",
        message: `换货源必须完整记录:${missing.join("、")}`,
        missing,
      });
    }
  } else if (!r.unitPrice?.trim()) {
    errors.push({ code: "replacement_required", message: "必须提供新单价" });
  }

  // 铁律 3:新价重过校验
  if (errors.length === 0) {
    const recheck = evaluateFlags(r, thresholds);
    if (recheck.flagged) {
      errors.push({
        code: "still_flagged",
        message: "新报价仍然超线,需继续处理或改选其它结论",
        reasons: recheck.reasons,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** 未处理数:仍是原始异常且没有有效结论的行数(铁律 5:流程状态用未处理数) */
export function unresolvedCount(
  lines: readonly FlaggedLineState[],
  thresholds: FlagThresholds,
): number {
  return lines.filter((l) => l.wasFlagged && !validateResolution(l, thresholds).ok).length;
}

/**
 * PM 需要确认的行:**全部原始异常行**。
 * 关键:不按"当前是否仍超线"过滤 —— 换了货源后价格达标的行同样必须让 PM 看到,
 * 否则处理过程对 PM 不可见,正是三轮诊断中被抓到的漏洞。
 */
export function linesRequiringPmConfirmation(
  lines: readonly FlaggedLineState[],
): FlaggedLineState[] {
  return lines.filter((l) => l.wasFlagged);
}

/** PM 确认是否完整覆盖全部原始异常行(铁律 5) */
export function isPmConfirmationComplete(
  lines: readonly FlaggedLineState[],
  confirmedLineIds: readonly string[],
): { complete: boolean; missing: string[] } {
  const need = linesRequiringPmConfirmation(lines).map((l) => l.lineId);
  const confirmed = new Set(confirmedLineIds);
  const missing = need.filter((id) => !confirmed.has(id));
  return { complete: missing.length === 0, missing };
}

export interface ProcurementProgress {
  totalLines: number;
  flaggedLines: number;
  unresolved: number;
  /** 全部原始异常行都已有有效结论 → 可反馈 PM */
  canSubmitToPm: boolean;
}

/** 落库视图:只有异常标记与结论,不含替代报价明细 */
export interface PersistedFlagLine {
  lineId: string;
  wasFlagged: boolean;
  resolution: FlagResolutionValue | null;
}

/**
 * 落库视图的流程状态(两阶段设计的第二阶段)。
 *
 * 第一阶段:写入结论时经 validateResolution 完整校验(替代报价七要素、新价重过校验),
 *          校验不通过根本写不进去,且过程记 AuditLog;
 * 第二阶段:提交前只需统计「原始异常行是否都已有结论」——
 *          不重复校验替代报价,也**绝不**为了让校验通过而伪造替代数据。
 */
export function persistedProgress(lines: readonly PersistedFlagLine[]): ProcurementProgress {
  const flagged = lines.filter((l) => l.wasFlagged);
  const unresolved = flagged.filter((l) => !l.resolution).length;
  return {
    totalLines: lines.length,
    flaggedLines: flagged.length,
    unresolved,
    canSubmitToPm: unresolved === 0,
  };
}

/** 采购侧流程状态(以未处理数驱动,不用"当前是否超线") */
export function procurementProgress(
  lines: readonly FlaggedLineState[],
  thresholds: FlagThresholds,
): ProcurementProgress {
  const flagged = linesRequiringPmConfirmation(lines);
  const unresolved = unresolvedCount(lines, thresholds);
  return {
    totalLines: lines.length,
    flaggedLines: flagged.length,
    unresolved,
    canSubmitToPm: unresolved === 0,
  };
}
