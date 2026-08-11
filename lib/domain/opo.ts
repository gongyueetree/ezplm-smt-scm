/**
 * OPO 交期协同(SPEC §14 + CLAUDE.md OPO 规则)。
 *
 * 铁律:**OPOLine 行级模型是唯一数据源**。
 * KPI、未回复表、差异表、异常清单**全部由本文件的纯函数从同一份行数据派生**,
 * 禁止任何旁路计数、禁止落冗余计数字段 —— 这是三轮诊断里"DOM 式旁路计数"的教训。
 */

export type ReplySourceValue = "EMAIL" | "PORTAL" | "EXCEL" | "PHONE" | "MANUAL";

/** 供应商回复(五字段齐备,SPEC §14) */
export interface OpoReplyView {
  replyEta: string | null;
  replyQty: number | null;
  replyNote: string | null;
  replyAt: string;
  replySource: ReplySourceValue;
}

/** OPO 行(派生计算的唯一输入) */
export interface OpoLineView {
  id: string;
  poNo: string;
  lineNo: number;
  supplierId: string;
  /** 供应商名称/编码;主数据里查不到时为 null —— **不回落成 id**,
   *  一串 cuid 摆在「供应商」列里比留空更容易被误读成编码 */
  supplierName: string | null;
  supplierCode: string | null;
  mpn: string | null;
  qtyOrdered: number;
  qtyOpen: number;
  /** ERP 承诺交期 */
  promiseDate: string | null;
  /** 需求日期 */
  needDate: string | null;
  /** 最新一条回复;无回复为 null */
  latestReply: OpoReplyView | null;
}

export type OpoAnomalyCode =
  | "no_reply"
  | "eta_later_than_need"
  | "eta_later_than_promise"
  | "qty_short"
  | "missing_eta"
  | "overdue";

export interface OpoAnomaly {
  code: OpoAnomalyCode;
  level: "error" | "warning";
  message: string;
}

/** 天数差(向下取整的整天);任一为空返回 null */
export function daysBetween(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.floor((to - from) / 86_400_000);
}

/** 该行的有效 ETA:供应商回复优先于 ERP 承诺 */
export function effectiveEta(line: OpoLineView): string | null {
  return line.latestReply?.replyEta ?? line.promiseDate ?? null;
}

/**
 * 单行异常判定(派生,不落库)。
 * 判定基准可注入 now,保证测试确定性。
 */
export function evaluateOpoLine(line: OpoLineView, now: string): OpoAnomaly[] {
  const anomalies: OpoAnomaly[] = [];

  if (!line.latestReply) {
    anomalies.push({ code: "no_reply", level: "warning", message: "供应商尚未回复交期" });
  }

  const eta = effectiveEta(line);
  if (!eta) {
    anomalies.push({ code: "missing_eta", level: "error", message: "既无回复 ETA 也无 ERP 承诺交期" });
  } else {
    const vsNeed = daysBetween(line.needDate, eta);
    if (vsNeed !== null && vsNeed > 0) {
      anomalies.push({
        code: "eta_later_than_need",
        level: "error",
        message: `ETA 晚于需求日期 ${vsNeed} 天`,
      });
    }
    const vsPromise = daysBetween(line.promiseDate, line.latestReply?.replyEta ?? null);
    if (vsPromise !== null && vsPromise > 0) {
      anomalies.push({
        code: "eta_later_than_promise",
        level: "warning",
        message: `回复 ETA 晚于 ERP 承诺 ${vsPromise} 天`,
      });
    }
    const overdue = daysBetween(eta, now);
    if (overdue !== null && overdue > 0 && line.qtyOpen > 0) {
      anomalies.push({
        code: "overdue",
        level: "error",
        message: `已过 ETA ${overdue} 天仍有未交数量 ${line.qtyOpen}`,
      });
    }
  }

  const replyQty = line.latestReply?.replyQty;
  if (replyQty !== null && replyQty !== undefined && replyQty < line.qtyOpen) {
    anomalies.push({
      code: "qty_short",
      level: "error",
      message: `回复数量 ${replyQty} 少于未交数量 ${line.qtyOpen}`,
    });
  }

  return anomalies;
}

export interface OpoKpi {
  totalLines: number;
  /** 未回复行数 */
  noReplyLines: number;
  /** 有任一 error 级异常的行数 */
  errorLines: number;
  /** 仅有 warning 的行数 */
  warningLines: number;
  /** 完全正常的行数 */
  healthyLines: number;
  /** 未交总量 */
  totalOpenQty: number;
  /** 回复率(0–1,保留 4 位) */
  replyRate: number;
}

/**
 * KPI 派生(SPEC §14:所有 KPI 必须从同一数据源渲染)。
 * 注意各分类互斥且求和等于总行数 —— 单测会钉死这一点,防止旁路计数造成对不上账。
 */
export function deriveOpoKpi(lines: readonly OpoLineView[], now: string): OpoKpi {
  let noReplyLines = 0;
  let errorLines = 0;
  let warningLines = 0;
  let healthyLines = 0;
  let totalOpenQty = 0;

  for (const l of lines) {
    totalOpenQty += l.qtyOpen;
    if (!l.latestReply) noReplyLines += 1;
    const anomalies = evaluateOpoLine(l, now);
    if (anomalies.some((a) => a.level === "error")) errorLines += 1;
    else if (anomalies.length > 0) warningLines += 1;
    else healthyLines += 1;
  }

  const replied = lines.length - noReplyLines;
  return {
    totalLines: lines.length,
    noReplyLines,
    errorLines,
    warningLines,
    healthyLines,
    totalOpenQty,
    replyRate: lines.length === 0 ? 0 : Number((replied / lines.length).toFixed(4)),
  };
}

/** 未回复表(派生) */
export function deriveNoReplyLines(lines: readonly OpoLineView[]): OpoLineView[] {
  return lines.filter((l) => !l.latestReply);
}

export interface OpoDiffRow {
  line: OpoLineView;
  promiseDate: string | null;
  replyEta: string | null;
  /** 回复 ETA − ERP 承诺(天);正数=晚于承诺 */
  deltaDays: number | null;
  qtyOrdered: number;
  replyQty: number | null;
  qtyDelta: number | null;
}

/** 差异表(派生):只列出回复与 ERP 承诺存在差异的行 */
export function deriveDiffRows(lines: readonly OpoLineView[]): OpoDiffRow[] {
  const rows: OpoDiffRow[] = [];
  for (const l of lines) {
    if (!l.latestReply) continue;
    const deltaDays = daysBetween(l.promiseDate, l.latestReply.replyEta);
    const qtyDelta =
      l.latestReply.replyQty === null || l.latestReply.replyQty === undefined
        ? null
        : l.latestReply.replyQty - l.qtyOpen;
    if ((deltaDays === null || deltaDays === 0) && (qtyDelta === null || qtyDelta === 0)) continue;
    rows.push({
      line: l,
      promiseDate: l.promiseDate,
      replyEta: l.latestReply.replyEta,
      deltaDays,
      qtyOrdered: l.qtyOrdered,
      replyQty: l.latestReply.replyQty,
      qtyDelta,
    });
  }
  return rows;
}

export interface OpoAnomalyRow {
  line: OpoLineView;
  anomalies: OpoAnomaly[];
}

/** 异常清单(派生) */
export function deriveAnomalyRows(lines: readonly OpoLineView[], now: string): OpoAnomalyRow[] {
  return lines
    .map((line) => ({ line, anomalies: evaluateOpoLine(line, now) }))
    .filter((r) => r.anomalies.length > 0);
}

// ============================================================
// 催办(SPEC §14:每日 Cron 扫描 nextReminderAt,提前四天催办)
// ============================================================

/** 提前催办天数(SPEC §14 明确为 4 天) */
export const REMINDER_LEAD_DAYS = 4;

export interface ReminderCandidate {
  line: OpoLineView;
  /** 距 ETA 还有几天 */
  daysUntilEta: number;
  /** 幂等键:同一行同一 ETA 同一天只发一次 */
  idempotencyKey: string;
}

/**
 * 计算某行是否应在 now 这天催办。
 * 规则:未回复 或 有未交数量,且 ETA 在 now 之后 REMINDER_LEAD_DAYS 天内。
 * 幂等键包含 lineId + ETA + 当天日期 —— ETA 变了要重新提醒,同一天重复扫描不重发。
 */
export function shouldRemind(line: OpoLineView, now: string): ReminderCandidate | null {
  if (line.qtyOpen <= 0) return null;
  const eta = effectiveEta(line);
  if (!eta) return null;

  const daysUntilEta = daysBetween(now, eta);
  if (daysUntilEta === null) return null;
  if (daysUntilEta < 0 || daysUntilEta > REMINDER_LEAD_DAYS) return null;

  const day = now.slice(0, 10);
  return {
    line,
    daysUntilEta,
    idempotencyKey: `opo-reminder:${line.id}:${eta.slice(0, 10)}:${day}`,
  };
}

/** 扫描应催办的行(Cron 用) */
export function collectReminderCandidates(
  lines: readonly OpoLineView[],
  now: string,
): ReminderCandidate[] {
  return lines
    .map((l) => shouldRemind(l, now))
    .filter((c): c is ReminderCandidate => c !== null)
    .sort((a, b) => a.daysUntilEta - b.daysUntilEta || a.line.id.localeCompare(b.line.id));
}
