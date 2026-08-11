/**
 * 报价的**订单结果**与真正的订单转化率(纯函数)。
 *
 * 客户 PR2-PM-06 要的是「订单转化率」,而系统原来算的是
 * `APPROVED / 终局版本` —— 那是**内部审批通过率**。
 * 两者含义完全不同:报价审批通过只说明我们把价报出去了,
 * 客户下不下单是另一回事。把审批通过率挂在"转化率"标签下,
 * 会让管理层以为成单情况一片大好。
 *
 * 客户 Q7 答复:「**人工在报价单上标记「已中标」**」——
 * 所以结果一律人工标记,系统**不从任何地方推断**:
 * 没有 ERP 订单对接,任何"自动判定中标"都是编的。
 */
import Decimal from "decimal.js";

export type QuoteOutcomeValue = "OPEN" | "WON" | "LOST" | "EXPIRED";

export const OUTCOME_LABEL: Record<QuoteOutcomeValue, string> = {
  OPEN: "待定",
  WON: "已中标",
  LOST: "未中标",
  EXPIRED: "已过期",
};

export interface OutcomeChangeInput {
  from: QuoteOutcomeValue;
  to: QuoteOutcomeValue;
  /** 改判理由 —— 从已定局的结果改回去时必填 */
  note: string | null;
  /** 报价是否已经报出去(审批通过)。没报出去就谈中标是荒谬的 */
  hasApprovedVersion: boolean;
}

export type OutcomeCheck = { ok: true } | { ok: false; code: string; message: string };

/**
 * 结果标记的校验。
 *
 * 刻意**不做**成一条单向状态机:业务上确实会先记错再改回来
 * (客户口头说中标、后来又给了别人)。禁止改动只会逼人去改数据库。
 * 但改判必须留下理由 —— 中标数是给管理层看的,悄悄变动比错更糟。
 */
export function checkOutcomeChange(input: OutcomeChangeInput): OutcomeCheck {
  if (input.from === input.to) {
    return { ok: false, code: "no_change", message: `当前已经是「${OUTCOME_LABEL[input.to]}」` };
  }
  if (input.to === "OPEN" && !input.note?.trim()) {
    return {
      ok: false,
      code: "note_required",
      message: "改回「待定」必须写明原因 —— 中标数会跟着变,不能悄悄改",
    };
  }
  if (input.from !== "OPEN" && !input.note?.trim()) {
    return {
      ok: false,
      code: "note_required",
      message: `从「${OUTCOME_LABEL[input.from]}」改为「${OUTCOME_LABEL[input.to]}」必须写明原因`,
    };
  }
  if (input.to === "WON" && !input.hasApprovedVersion) {
    return {
      ok: false,
      code: "not_approved",
      message: "这张报价还没有任何审批通过的版本 —— 没报出去的价谈不上中标",
    };
  }
  return { ok: true };
}

export interface OutcomeRow {
  outcome: QuoteOutcomeValue;
  /** 该报价的成交金额(取已批准快照的总价);未知为 null,**不按 0 算** */
  amount: string | null;
  currency: string;
}

export interface ConversionSummary {
  total: number;
  byOutcome: Record<QuoteOutcomeValue, number>;
  /**
   * 订单转化率 = 已中标 /(已中标 + 未中标 + 已过期)。
   * 分母**不含「待定」** —— 还没有结果的报价不该拉低或抬高转化率。
   * 没有任何定局报价时返回 null,不显示成 0%。
   */
  orderConversionRate: number | null;
  /** 仍在等结果的报价数 —— 与转化率并列显示,否则分母小得没有说服力 */
  pending: number;
  /** 中标金额(按币种分开,**不跨币种相加**) */
  wonAmountByCurrency: Record<string, string>;
  /** 中标但金额未知的张数 —— 金额栏必须为此留一句话,不能当成 0 */
  wonWithoutAmount: number;
}

export function summarizeConversion(rows: readonly OutcomeRow[]): ConversionSummary {
  const byOutcome: Record<QuoteOutcomeValue, number> = { OPEN: 0, WON: 0, LOST: 0, EXPIRED: 0 };
  const wonAmountByCurrency: Record<string, string> = {};
  let wonWithoutAmount = 0;

  for (const r of rows) {
    byOutcome[r.outcome] += 1;
    if (r.outcome !== "WON") continue;
    if (r.amount === null) {
      wonWithoutAmount += 1;
      continue;
    }
    // 金额一律走 Decimal:中标金额是给管理层看的数,不能有浮点尾差
    wonAmountByCurrency[r.currency] = new Decimal(wonAmountByCurrency[r.currency] ?? "0")
      .plus(new Decimal(r.amount))
      .toFixed(2);
  }

  const settled = byOutcome.WON + byOutcome.LOST + byOutcome.EXPIRED;
  return {
    total: rows.length,
    byOutcome,
    orderConversionRate: settled === 0 ? null : Number((byOutcome.WON / settled).toFixed(4)),
    pending: byOutcome.OPEN,
    wonAmountByCurrency,
    wonWithoutAmount,
  };
}
