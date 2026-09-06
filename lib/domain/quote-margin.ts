/**
 * F1:毛利(Gross Margin)—— 纯函数。
 *
 * 一处必须先说破的陷阱:**不能从报价快照的 summary.lines 算成本**。
 * summarizeQuote 里 `dec(l.purchaseCost)` 把 null 变成 0,快照分不清
 * 「成本为零」与「没填成本」—— 从快照算毛利会把缺成本的行当零成本,
 * **毛利凭空虚高**。所以成本必须取冻结版本的 QuoteLine 原始行
 * (null 语义还在);收入取快照的 grandTotal(审批冻结口径)。
 * 两者可混用的前提是冻结纪律:APPROVED 后行参数不可改。
 *
 * 三条纪律:
 * - 任何一行缺采购成本 → 整张报价**不参与**毛利,单列计数并给原因 ——
 *   部分成本算出来的"毛利"比没有更误导;
 * - 异币种各算各的,不合并;
 * - 没有可算的报价 → null,不显示 0%。
 */
import Decimal from "decimal.js";

export interface MarginLineInput {
  qty: string | null;
  purchaseCost: string | null;
}

export interface QuoteMarginInput {
  quoteCode: string;
  currency: string;
  /** 审批快照的冻结总价 */
  grandTotal: string;
  lines: MarginLineInput[];
}

export interface CurrencyMargin {
  currency: string;
  revenue: string;
  cost: string;
  /** (收入 − 成本) / 收入;收入为 0 时 null */
  marginPct: string | null;
  quoteCount: number;
}

export interface GrossMarginResult {
  byCurrency: CurrencyMargin[];
  computableQuotes: number;
  /** 被排除的报价与原因 —— 界面必须显示,不许静默少算 */
  excluded: { quoteCode: string; reason: string }[];
}

function safeDec(v: string | null): Decimal | null {
  if (v === null || v.trim() === "") return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function computeGrossMargin(quotes: readonly QuoteMarginInput[]): GrossMarginResult {
  const acc = new Map<string, { revenue: Decimal; cost: Decimal; count: number }>();
  const excluded: { quoteCode: string; reason: string }[] = [];

  for (const q of quotes) {
    const revenue = safeDec(q.grandTotal);
    if (!revenue) {
      excluded.push({ quoteCode: q.quoteCode, reason: "冻结总价缺失或非法" });
      continue;
    }
    let cost = new Decimal(0);
    let missing = 0;
    for (const l of q.lines) {
      const c = safeDec(l.purchaseCost);
      const qty = safeDec(l.qty);
      if (c === null || qty === null) {
        missing += 1;
        continue;
      }
      cost = cost.plus(c.mul(qty));
    }
    if (missing > 0) {
      excluded.push({
        quoteCode: q.quoteCode,
        reason: `${missing} 行缺采购成本或数量 —— 部分成本算出的毛利比没有更误导`,
      });
      continue;
    }
    const cur = q.currency.toUpperCase();
    const slot = acc.get(cur) ?? { revenue: new Decimal(0), cost: new Decimal(0), count: 0 };
    slot.revenue = slot.revenue.plus(revenue);
    slot.cost = slot.cost.plus(cost);
    slot.count += 1;
    acc.set(cur, slot);
  }

  return {
    byCurrency: [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, v]) => ({
        currency,
        revenue: v.revenue.toFixed(2),
        cost: v.cost.toFixed(2),
        marginPct: v.revenue.isZero()
          ? null
          : v.revenue.minus(v.cost).div(v.revenue).toFixed(4),
        quoteCount: v.count,
      })),
    computableQuotes: [...acc.values()].reduce((n, v) => n + v.count, 0),
    excluded,
  };
}
