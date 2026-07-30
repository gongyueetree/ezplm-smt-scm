/**
 * 应收应付账龄分析(客户 xlsx「应收应付全生命周期管理、账龄分析与报表生成」—— 原标注为「无」)。
 *
 * 纪律:
 * - **到期日未知的单列一档,绝不并入最新桶**。这与库存 DC Aging 是同一条教训:
 *   把未知塞进 0–30 天,会让一笔可能已经逾期两年的欠款看着最健康;
 * - 逾期按"已过到期日的天数"分桶,未到期单列 —— 未到期不是账龄 0;
 * - 只算不判:不给"坏账""需计提"这类结论,那是财务的判断。
 */
import Decimal from "decimal.js";

export const AGING_BUCKETS = ["未到期", "0-30", "31-60", "61-90", "90+", "到期日未知"] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export interface AgingInputLine {
  /** 金额(同币种;调用方负责分币种调用) */
  amount: string;
  /** 到期日 ISO;null / 非法 → 归入「到期日未知」 */
  dueDate: string | null;
}

export interface AgingBucketResult {
  bucket: AgingBucket;
  count: number;
  amount: string;
}

export interface AgingResult {
  currency: string;
  buckets: AgingBucketResult[];
  total: string;
  /** 已逾期合计(0-30 起算,不含未到期与未知) */
  overdueTotal: string;
  /** 到期日未知的金额 —— 单独暴露,便于 UI 明确提示"这部分账龄不可知" */
  unknownDueTotal: string;
}

const MS_PER_DAY = 86_400_000;

function dayStart(iso: string): number | null {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00.000Z`);
  return Number.isFinite(t) ? t : null;
}

/** 逾期天数;未到期返回负数;日期不可解析返回 null */
export function overdueDays(dueDate: string | null, asOf: string): number | null {
  if (!dueDate) return null;
  const due = dayStart(dueDate);
  const now = dayStart(asOf);
  if (due === null || now === null) return null;
  return Math.round((now - due) / MS_PER_DAY);
}

export function bucketOf(dueDate: string | null, asOf: string): AgingBucket {
  const days = overdueDays(dueDate, asOf);
  if (days === null) return "到期日未知";
  if (days <= 0) return "未到期";
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function computeAging(
  lines: readonly AgingInputLine[],
  asOf: string,
  currency = "CNY",
): AgingResult {
  const acc = new Map<AgingBucket, { count: number; amount: Decimal }>();
  for (const b of AGING_BUCKETS) acc.set(b, { count: 0, amount: new Decimal(0) });

  let total = new Decimal(0);
  for (const l of lines) {
    let amt: Decimal;
    try {
      amt = new Decimal(l.amount);
      if (!amt.isFinite()) amt = new Decimal(0);
    } catch {
      amt = new Decimal(0);
    }
    const b = bucketOf(l.dueDate, asOf);
    const cur = acc.get(b)!;
    cur.count += 1;
    cur.amount = cur.amount.add(amt);
    total = total.add(amt);
  }

  const overdueBuckets: AgingBucket[] = ["0-30", "31-60", "61-90", "90+"];
  const overdueTotal = overdueBuckets.reduce(
    (a, b) => a.add(acc.get(b)!.amount),
    new Decimal(0),
  );

  return {
    currency,
    buckets: AGING_BUCKETS.map((b) => ({
      bucket: b,
      count: acc.get(b)!.count,
      amount: acc.get(b)!.amount.toFixed(),
    })),
    total: total.toFixed(),
    overdueTotal: overdueTotal.toFixed(),
    unknownDueTotal: acc.get("到期日未知")!.amount.toFixed(),
  };
}
