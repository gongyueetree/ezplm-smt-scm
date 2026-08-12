/**
 * 汇率 Provider(E8 / 客户 Q8:「ERP 系统有汇率显示,**请引用**」)。
 *
 * 因此:**不再去找外部汇率 API**,统一从 ERP(金蝶 K3 云星空)取。
 * 在拿到接口与口径之前(O1 文档账号 / O3 汇率类型与有效日期),
 * 这里只有两条路:库里已人工导入的汇率,或者**明确的"没有汇率"**。
 *
 * 三条纪律:
 * 1. **换算结果永远叫「换算参考价」**,不冒充供应商正式报价 ——
 *    供应商报的是 USD,换成 CNY 只是给我们自己看的参考;
 * 2. 换算必须留痕:源币种/目标币种/汇率/来源/生效日/取数时间/是否估算,
 *    少任何一项都会让事后"为什么当时算成这个数"答不上来;
 * 3. **没有汇率就返回 null,不猜、不用 1:1、不拿旧汇率硬顶**。
 */
import Decimal from "decimal.js";

export type FxSource = "KINGDEE" | "MANUAL";

export interface FxRateRecord {
  sourceCurrency: string;
  targetCurrency: string;
  /** 字符串保精度 */
  rate: string;
  rateType: string | null;
  effectiveDate: string;
  source: FxSource;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
}

export interface ConvertedAmount {
  /** 原始金额与币种 —— 永远保留,换算不覆盖原值 */
  originalAmount: string;
  sourceCurrency: string;
  targetCurrency: string;
  /** 换算参考价。拿不到汇率时为 null(**不是 0,也不是原值**) */
  convertedAmount: string | null;
  rate: string | null;
  rateType: string | null;
  fxSource: FxSource | null;
  fxEffectiveDate: string | null;
  fxFetchedAt: string | null;
  /**
   * 是否为估算:用了非当日/非指定类型的汇率时为 true。
   * 界面必须据此加标注 —— 用上个月的汇率算出来的数,不能当成今天的价。
   */
  estimated: boolean;
  /** 拿不到汇率的原因,直接显示给用户 */
  unavailableReason: string | null;
}

/** 同币种直接返回原值 —— 不需要汇率,也不该标成估算 */
function sameCurrency(amount: string, currency: string): ConvertedAmount {
  return {
    originalAmount: amount,
    sourceCurrency: currency,
    targetCurrency: currency,
    convertedAmount: amount,
    rate: "1",
    rateType: null,
    fxSource: null,
    fxEffectiveDate: null,
    fxFetchedAt: null,
    estimated: false,
    unavailableReason: null,
  };
}

export interface ConvertInput {
  amount: string;
  sourceCurrency: string;
  targetCurrency: string;
  /** 期望的业务日期(YYYY-MM-DD);用于判断汇率是否"当日" */
  onDate: string;
  /** 候选汇率(调用方从库里查好传进来,便于纯函数化与测试) */
  candidates: readonly FxRateRecord[];
}

/**
 * 换算。
 *
 * 选汇率的规则:同币种对里,**生效日 ≤ 业务日**的最新一条。
 * 生效日不等于业务日时标 `estimated=true` —— 用的不是当天的汇率,
 * 这一点必须让人看见,而不是悄悄用上个月的数。
 */
export function convertAmount(input: ConvertInput): ConvertedAmount {
  const src = input.sourceCurrency.toUpperCase();
  const dst = input.targetCurrency.toUpperCase();
  if (src === dst) return sameCurrency(input.amount, src);

  const usable = input.candidates
    .filter(
      (c) =>
        c.sourceCurrency.toUpperCase() === src &&
        c.targetCurrency.toUpperCase() === dst &&
        c.effectiveDate <= input.onDate,
    )
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1));

  const hit = usable[0];
  if (!hit) {
    return {
      originalAmount: input.amount,
      sourceCurrency: src,
      targetCurrency: dst,
      convertedAmount: null,
      rate: null,
      rateType: null,
      fxSource: null,
      fxEffectiveDate: null,
      fxFetchedAt: null,
      estimated: false,
      unavailableReason:
        `没有 ${src} → ${dst} 在 ${input.onDate} 及之前的汇率。` +
        `汇率来源为 ERP(客户 Q8),接口尚未接通 —— 可先人工导入一条,` +
        `系统**不会**用 1:1 或旧汇率替你顶上。`,
    };
  }

  let converted: string;
  try {
    converted = new Decimal(input.amount).mul(new Decimal(hit.rate)).toFixed(2);
  } catch {
    return {
      originalAmount: input.amount,
      sourceCurrency: src,
      targetCurrency: dst,
      convertedAmount: null,
      rate: hit.rate,
      rateType: hit.rateType,
      fxSource: hit.source,
      fxEffectiveDate: hit.effectiveDate,
      fxFetchedAt: hit.fetchedAt,
      estimated: true,
      unavailableReason: `金额或汇率不是有效数字(金额 ${input.amount} / 汇率 ${hit.rate})`,
    };
  }

  return {
    originalAmount: input.amount,
    sourceCurrency: src,
    targetCurrency: dst,
    convertedAmount: converted,
    rate: hit.rate,
    rateType: hit.rateType,
    fxSource: hit.source,
    fxEffectiveDate: hit.effectiveDate,
    fxFetchedAt: hit.fetchedAt,
    // 不是当日汇率就是估算
    estimated: hit.effectiveDate !== input.onDate,
    unavailableReason: null,
  };
}

/** 界面标签 —— 换算价**永远**带这个前缀,不允许省略 */
export const CONVERTED_LABEL = "换算参考价";

export function convertedNote(c: ConvertedAmount): string {
  if (c.convertedAmount === null) return c.unavailableReason ?? "无法换算";
  const base =
    `${CONVERTED_LABEL}:${c.targetCurrency} ${c.convertedAmount}` +
    `(汇率 ${c.rate},${c.fxSource === "KINGDEE" ? "来自 ERP" : "人工维护"},生效日 ${c.fxEffectiveDate})`;
  return c.estimated
    ? `${base} —— **非当日汇率,属估算**;正式对外报价请以原币种 ${c.sourceCurrency} ${c.originalAmount} 为准`
    : `${base} —— 仅供内部横向比较,正式报价以原币种为准`;
}
