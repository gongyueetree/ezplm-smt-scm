/**
 * 采购订单价格复核:**历史价对比与异常预警**
 * (客户 xlsx 原话「采购订单批量录入、历史价对比与异常预警」)。
 *
 * 阈值类异常(价格线/交期线/异币种)复用既有的 `evaluateFlags` —— 不重造,
 * 也保证 PO 与比价页用的是同一套判定口径。本文件只补历史价这一维。
 *
 * 纪律:
 * - **无历史价 ≠ 价格正常**:首次采购必须显式说"无同料历史成交价可比",
 *   不能留空、更不能显示成"正常"——那会让复核人以为已经比过了;
 * - **异币种不做换算**(全局规则):历史价币种与当前不同时判"不可比",
 *   而不是按某个汇率折过来比;
 * - 涨幅告警线默认 10% 且标注**未经甲方确认**,与损耗率默认 0 的处理方式一致;
 * - 只给结论与依据,**不自动改价** —— 调价是人工动作。
 */
import Decimal from "decimal.js";
import {
  evaluateFlags,
  type FlagReason,
  type FlagThresholds,
  type QuoteSnapshot,
} from "./procurement-flags";

/** 涨幅告警线缺省值;**口径未经甲方确认**,UI 必须标注 */
export const DEFAULT_MAX_INCREASE_RATE = "0.1";

/** 一次历史成交(来自已批准的 PO 行) */
export interface PriceHistoryPoint {
  unitPrice: string;
  currency: string;
  supplierId: string;
  poNo: string;
  /** ISO 时间串 */
  approvedAt: string;
}

export type PriceTrendVerdict = "首次采购" | "持平" | "下降" | "上涨" | "涨幅超线" | "不可比";

export interface HistoryComparison {
  verdict: PriceTrendVerdict;
  /** 相对最近一次**同币种**成交价的变化率(十进制字符串,正=涨);不可比时为 null */
  changeRate: string | null;
  /** 参照的那一条历史成交;无可比时为 null */
  reference: PriceHistoryPoint | null;
  detail: string;
}

function toDecimalOrNull(v: string | null | undefined): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** 取最近一条同币种历史成交(按 approvedAt 倒序) */
function latestSameCurrency(
  history: readonly PriceHistoryPoint[],
  currency: string,
): PriceHistoryPoint | null {
  const same = history
    .filter((h) => h.currency.toUpperCase() === currency.toUpperCase())
    .filter((h) => toDecimalOrNull(h.unitPrice)?.gt(0) ?? false)
    .slice()
    .sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : a.approvedAt > b.approvedAt ? -1 : 0));
  return same[0] ?? null;
}

export function compareWithHistory(
  current: { unitPrice: string | null; currency: string },
  history: readonly PriceHistoryPoint[],
  options: { maxIncreaseRate?: string | null } = {},
): HistoryComparison {
  const price = toDecimalOrNull(current.unitPrice);
  if (price === null || price.lte(0)) {
    return {
      verdict: "不可比",
      changeRate: null,
      reference: null,
      detail: "当前行未填有效单价,无法与历史价比较",
    };
  }

  if (history.length === 0) {
    return {
      verdict: "首次采购",
      changeRate: null,
      reference: null,
      detail: "无同料历史成交价可比(首次采购)—— 非「价格正常」,请人工判断",
    };
  }

  const ref = latestSameCurrency(history, current.currency);
  if (!ref) {
    // 「取不到参照」有两种完全不同的原因,必须分开说 ——
    // 混成一句会吐出「历史成交均为 CNY,与当前 CNY 不同」这种自相矛盾的提示。
    const sameCurrencyCount = history.filter(
      (h) => h.currency.toUpperCase() === current.currency.toUpperCase(),
    ).length;
    if (sameCurrencyCount > 0) {
      return {
        verdict: "不可比",
        changeRate: null,
        reference: null,
        detail: `有 ${sameCurrencyCount} 条同币种历史成交,但单价为零或非法,无法作为参照 —— 请核对历史单据`,
      };
    }
    const currencies = [...new Set(history.map((h) => h.currency.toUpperCase()))].join("、");
    return {
      verdict: "不可比",
      changeRate: null,
      reference: null,
      detail: `历史成交均为 ${currencies},与当前 ${current.currency.toUpperCase()} 不同;系统不做汇率换算,故不可比`,
    };
  }

  const last = toDecimalOrNull(ref.unitPrice)!;
  const rate = price.minus(last).div(last);
  const pct = rate.mul(100).toDecimalPlaces(2).toFixed();
  const base = `最近成交 ${ref.currency} ${ref.unitPrice}(${ref.poNo} · ${ref.approvedAt.slice(0, 10)})`;

  if (rate.isZero()) {
    return { verdict: "持平", changeRate: "0", reference: ref, detail: `与${base}持平` };
  }

  if (rate.lt(0)) {
    return {
      verdict: "下降",
      changeRate: rate.toDecimalPlaces(6).toFixed(),
      reference: ref,
      detail: `较${base}下降 ${pct.replace("-", "")}%`,
    };
  }

  const limit = toDecimalOrNull(options.maxIncreaseRate ?? DEFAULT_MAX_INCREASE_RATE);
  if (limit !== null && rate.gt(limit)) {
    return {
      verdict: "涨幅超线",
      changeRate: rate.toDecimalPlaces(6).toFixed(),
      reference: ref,
      detail: `较${base}上涨 ${pct}%,超过告警线 ${limit.mul(100).toFixed()}%`,
    };
  }

  return {
    verdict: "上涨",
    changeRate: rate.toDecimalPlaces(6).toFixed(),
    reference: ref,
    detail: `较${base}上涨 ${pct}%,未超告警线`,
  };
}

export type PoFlagSeverity = "error" | "warn" | "info";

export interface PoLineFlag {
  code: FlagReason["code"] | "price_increase_over_limit" | "no_price_history" | "history_incomparable";
  severity: PoFlagSeverity;
  detail: string;
}

export interface PoLineReviewInput {
  lineNo: number;
  quote: QuoteSnapshot;
  history?: readonly PriceHistoryPoint[];
}

export interface PoLineReview {
  lineNo: number;
  history: HistoryComparison;
  flags: PoLineFlag[];
  /** 存在 error 级异常 → 必须人工处理后才能提交复核 */
  hasError: boolean;
}

export interface PoReviewPolicy extends FlagThresholds {
  maxIncreaseRate?: string | null;
  /** 阈值口径是否经业务确认;false 时 UI 必须标注"演示阈值,非正式风控" */
  confirmedByBusiness: boolean;
}

/**
 * 复核一行:阈值异常(复用 evaluateFlags)+ 历史价对比。
 *
 * error 级 = 必须人工处理(超价格线 / 超交期线 / 异币种 / 涨幅超线);
 * info 级 = 必须**如实展示**但不阻塞(首次采购 / 异币种历史不可比)。
 */
export function reviewPoLine(input: PoLineReviewInput, policy: PoReviewPolicy): PoLineReview {
  const suffix = policy.confirmedByBusiness ? "" : "(演示阈值,非正式风控)";
  const flags: PoLineFlag[] = [];

  const { reasons } = evaluateFlags(input.quote, policy);
  for (const r of reasons) {
    flags.push({ code: r.code, severity: "error", detail: `${r.detail}${suffix}` });
  }

  const history = compareWithHistory(
    { unitPrice: input.quote.unitPrice, currency: input.quote.currency },
    input.history ?? [],
    { maxIncreaseRate: policy.maxIncreaseRate },
  );

  if (history.verdict === "涨幅超线") {
    flags.push({
      code: "price_increase_over_limit",
      severity: "error",
      detail: `${history.detail}${suffix}`,
    });
  } else if (history.verdict === "首次采购") {
    flags.push({ code: "no_price_history", severity: "info", detail: history.detail });
  } else if (history.verdict === "不可比") {
    flags.push({ code: "history_incomparable", severity: "info", detail: history.detail });
  }

  return {
    lineNo: input.lineNo,
    history,
    flags,
    hasError: flags.some((f) => f.severity === "error"),
  };
}
