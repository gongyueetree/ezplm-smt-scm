/**
 * 管理工作台 KPI(SPEC §16)。
 * 与 OPO 同一纪律:**全部由明细派生**,不落任何汇总字段。
 * DC Aging 与呆滞判定的阈值口径需业务确认,函数只按给定阈值算。
 */

export interface QuoteStatRow {
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED";
  /** 该版本的总价(十进制字符串;来自快照或实时汇总) */
  grandTotal: string | null;
  currency: string;
}

export interface QuoteStats {
  total: number;
  byStatus: Record<QuoteStatRow["status"], number>;
  /** 已批准金额合计(仅统计同币种;异币种不合并) */
  approvedAmountByCurrency: Record<string, string>;
  /** 转化率 = 已批准 / (已批准 + 已退回 + 已过期);无终局版本时为 null 而非 0 */
  conversionRate: number | null;
}

function addDecimalStrings(a: string, b: string): string {
  // 仅做整数分级相加,避免引入依赖;两侧都是 toFixed(2) 产物
  const toCents = (s: string) => Math.round(Number(s) * 100);
  return ((toCents(a) + toCents(b)) / 100).toFixed(2);
}

export function deriveQuoteStats(rows: readonly QuoteStatRow[]): QuoteStats {
  const byStatus: QuoteStats["byStatus"] = {
    DRAFT: 0,
    PENDING_APPROVAL: 0,
    APPROVED: 0,
    REJECTED: 0,
    EXPIRED: 0,
  };
  const approvedAmountByCurrency: Record<string, string> = {};

  for (const r of rows) {
    byStatus[r.status] += 1;
    if (r.status === "APPROVED" && r.grandTotal) {
      approvedAmountByCurrency[r.currency] = addDecimalStrings(
        approvedAmountByCurrency[r.currency] ?? "0",
        r.grandTotal,
      );
    }
  }

  const settled = byStatus.APPROVED + byStatus.REJECTED + byStatus.EXPIRED;
  return {
    total: rows.length,
    byStatus,
    approvedAmountByCurrency,
    // 没有任何终局版本时转化率无定义 —— 返回 null,不显示成 0%
    conversionRate: settled === 0 ? null : Number((byStatus.APPROVED / settled).toFixed(4)),
  };
}

export interface InventoryAgingRow {
  partId: string;
  mpn: string | null;
  qtyOnHand: number;
  qtySlowMoving: number | null;
  /** 物料 DC(日期码),格式如 "2523" = 25 年第 23 周 */
  dateCode: string | null;
  fetchedAt: string;
}

export interface AgingBucket {
  label: string;
  /** 起始月龄(含) */
  minMonths: number;
  count: number;
  qty: number;
}

/** DC 日期码 → 大致生产日期;无法解析返回 null(不猜) */
export function parseDateCode(dc: string | null | undefined): Date | null {
  if (!dc) return null;
  const m = dc.trim().match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan1 = Date.UTC(year, 0, 1);
  return new Date(jan1 + (week - 1) * 7 * 86_400_000);
}

/** 月龄;DC 无法解析返回 null */
export function ageInMonths(dc: string | null | undefined, now: string): number | null {
  const made = parseDateCode(dc);
  if (!made) return null;
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return null;
  return Math.floor((nowMs - made.getTime()) / (30 * 86_400_000));
}

export const DEFAULT_AGING_BUCKETS = [0, 6, 12, 24] as const;

export interface AgingReport {
  buckets: AgingBucket[];
  /** DC 缺失或无法解析的行 —— 单列,不并入任何桶(诚实:未知不等于新) */
  unknownDateCode: { count: number; qty: number };
}

/**
 * DC Aging 分桶(SPEC §16)。
 * ⚠ 分桶阈值(6/12/24 月)为示例口径,需业务确认;
 * DC 无法解析的行**单独统计**,绝不并入"0–6 月"制造出"库存很新"的假象。
 */
export function deriveDcAging(
  rows: readonly InventoryAgingRow[],
  now: string,
  bucketStarts: readonly number[] = DEFAULT_AGING_BUCKETS,
): AgingReport {
  const starts = [...bucketStarts].sort((a, b) => a - b);
  const buckets: AgingBucket[] = starts.map((min, i) => ({
    label:
      i === starts.length - 1 ? `${min} 月以上` : `${min}–${starts[i + 1]} 月`,
    minMonths: min,
    count: 0,
    qty: 0,
  }));
  const unknown = { count: 0, qty: 0 };

  for (const r of rows) {
    const months = ageInMonths(r.dateCode, now);
    if (months === null) {
      unknown.count += 1;
      unknown.qty += r.qtyOnHand;
      continue;
    }
    let idx = 0;
    for (let i = 0; i < starts.length; i++) if (months >= starts[i]) idx = i;
    buckets[idx].count += 1;
    buckets[idx].qty += r.qtyOnHand;
  }

  return { buckets, unknownDateCode: unknown };
}

export interface SlowMovingSummary {
  totalParts: number;
  slowMovingParts: number;
  slowMovingQty: number;
  /** 呆滞数量未知的物料数(不并入正常,也不并入呆滞) */
  unknownParts: number;
}

/** 呆滞汇总:未知与 0 严格区分 */
export function deriveSlowMoving(rows: readonly InventoryAgingRow[]): SlowMovingSummary {
  let slowMovingParts = 0;
  let slowMovingQty = 0;
  let unknownParts = 0;

  for (const r of rows) {
    if (r.qtySlowMoving === null || r.qtySlowMoving === undefined) {
      unknownParts += 1;
      continue;
    }
    if (r.qtySlowMoving > 0) {
      slowMovingParts += 1;
      slowMovingQty += r.qtySlowMoving;
    }
  }

  return { totalParts: rows.length, slowMovingParts, slowMovingQty, unknownParts };
}
