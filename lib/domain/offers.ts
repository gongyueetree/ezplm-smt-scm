/**
 * 报价确定性计算与排名(SPEC §10)。
 *
 * 纪律(CLAUDE.md 硬性约束 2):所有价格/金额由本文件的确定性函数计算,
 * 一律使用 Decimal,禁止 JS 浮点参与金额运算,禁止由 LLM 生成数值。
 * 排名结果只是「建议顺序」,正式供应商选择必须人工确认(硬性约束 3)。
 */
import { Decimal } from "decimal.js";
import { manufacturerMatches } from "@/lib/providers/common/mpn";
import type {
  LifecycleValue,
  NormalizedOffer,
  NormalizedPriceBreak,
} from "@/lib/providers/common/normalized-offer";

export { Decimal };

// ============================================================
// 1. 价格阶梯选择
// ============================================================

/**
 * 取适用价格阶梯:满足 minQty <= qty 的阶梯中 minQty 最大的一档。
 * qty 低于最低阶梯时返回 null —— 调用方必须先经 calculateRoundedPurchaseQty
 * 完成 MOQ/SPQ 圆整,再来取价,避免用不可下单的数量取到价格。
 */
export function getApplicablePriceBreak(
  breaks: readonly NormalizedPriceBreak[],
  qty: number,
): NormalizedPriceBreak | null {
  if (!Number.isFinite(qty) || qty <= 0) return null;
  let best: NormalizedPriceBreak | null = null;
  for (const b of breaks) {
    if (b.minQty <= qty && (best === null || b.minQty > best.minQty)) best = b;
  }
  return best;
}

// ============================================================
// 2. MOQ / SPQ 圆整
// ============================================================

export interface RoundingRule {
  moq?: number | null;
  spq?: number | null;
}

/**
 * 采购数量圆整(CLAUDE.md GTB 规则的圆整段):
 * 结果不低于 MOQ,再按 SPQ 向上圆整为整包倍数。
 * 需求 <= 0 时返回 0(不产生采购)。
 */
export function calculateRoundedPurchaseQty(demandQty: number, rule: RoundingRule = {}): number {
  if (!Number.isFinite(demandQty) || demandQty <= 0) return 0;
  const moq = rule.moq && rule.moq > 0 ? rule.moq : 0;
  const spq = rule.spq && rule.spq > 0 ? rule.spq : 0;
  let qty = Math.max(demandQty, moq);
  qty = Math.ceil(qty);
  if (spq > 0) qty = Math.ceil(qty / spq) * spq;
  return qty;
}

// ============================================================
// 3. 金额计算
// ============================================================

/**
 * 总价 = 单价 × 数量(全精度,不做币种舍入)。
 * 舍入时机交由报价单/采购单按币种最小单位统一处理,避免中间舍入误差累积。
 */
export function calculateExtendedPrice(unitPrice: string | Decimal, qty: number): Decimal {
  return new Decimal(unitPrice).mul(qty);
}

/** 按币种最小单位舍入(展示/落单用);默认 2 位,四舍五入 */
export function roundMoney(amount: Decimal | string, decimals = 2): Decimal {
  return new Decimal(amount).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
}

// ============================================================
// 4. 报价评估(排名的确定性输入)
// ============================================================

export interface RankContext {
  /** 需求数量(BOM 用量 × 台数 或 GTB 结果) */
  demandQty: number;
  /** 比价币种;与之不同币种的报价不参与可比排名(不做汇率换算) */
  currency: string;
  /**
   * 期望制造商。设置后,同 MPN 但制造商不符的报价不参与可比排名 ——
   * 三方按 MPN 检索可能带回同号异厂料(如查 STM32F103C8T6 却返回
   * "Microchip / Microsemi" 的记录),它们不是同一颗料,不能同表比价。
   * 不设置 = 不做制造商约束(调用方明确知道自己在混比时)。
   */
  expectedManufacturer?: string;
  /** 供应商优先级缺省值(offer 未带时使用) */
  defaultSupplierPriority?: number;
}

export interface OfferEvaluation {
  offer: NormalizedOffer;
  /** 经 MOQ/SPQ 圆整后的实际采购数量 */
  purchaseQty: number;
  appliedBreak: NormalizedPriceBreak | null;
  unitPrice: Decimal | null;
  extendedPrice: Decimal | null;
  /** 现货可满足:库存 >= 采购数量 */
  stockCovered: boolean;
  /** 库存覆盖比例 0–1(库存未知按 0 计) */
  stockCoverage: number;
  leadTimeDays: number | null;
  /** 制造商相符、币种一致、且能取到适用价格 → 可参与可比排名 */
  comparable: boolean;
  /** 不可比原因(诚实展示,不静默丢弃) */
  incomparableReason: "manufacturer_mismatch" | "currency_mismatch" | "no_price_break" | null;
}

/** 生命周期评分:EOL/停产在同价时必须排后 */
const LIFECYCLE_SCORE: Record<LifecycleValue, number> = {
  ACTIVE: 1,
  NRND: 0.5,
  UNKNOWN: 0.6,
  EOL: 0.15,
  OBSOLETE: 0,
};

export function evaluateOffer(offer: NormalizedOffer, ctx: RankContext): OfferEvaluation {
  const purchaseQty = calculateRoundedPurchaseQty(ctx.demandQty, {
    moq: offer.moq,
    spq: offer.spq,
  });
  const currencyMismatch = offer.currency.toUpperCase() !== ctx.currency.toUpperCase();
  const appliedBreak = getApplicablePriceBreak(offer.priceBreaks, purchaseQty);
  const unitPrice = appliedBreak ? new Decimal(appliedBreak.unitPrice) : null;
  const extendedPrice = unitPrice ? calculateExtendedPrice(unitPrice, purchaseQty) : null;
  const stock = offer.stock ?? 0;
  const stockCoverage =
    purchaseQty > 0 ? Math.min(1, stock / purchaseQty) : stock > 0 ? 1 : 0;

  // 顺序即严重度:异厂商(根本不是同一颗料)> 异币种 > 取不到阶梯价
  const manufacturerMismatch = !manufacturerMatches(offer.manufacturer, ctx.expectedManufacturer);
  const incomparableReason = manufacturerMismatch
    ? ("manufacturer_mismatch" as const)
    : currencyMismatch
      ? ("currency_mismatch" as const)
      : appliedBreak === null
        ? ("no_price_break" as const)
        : null;

  return {
    offer,
    purchaseQty,
    appliedBreak,
    unitPrice,
    extendedPrice,
    stockCovered: purchaseQty > 0 && stock >= purchaseQty,
    stockCoverage,
    leadTimeDays: offer.leadTimeDays,
    comparable: incomparableReason === null,
    incomparableReason,
  };
}

// ============================================================
// 5. 比较与排名
// ============================================================

/** 评分权重(SPEC §10:排名不能只看最低单价) */
export const RANK_WEIGHTS = {
  price: 0.45,
  availability: 0.25,
  leadTime: 0.15,
  lifecycle: 0.1,
  supplier: 0.05,
} as const;

/** 交期评分的封顶天数:超过此天数按最差处理 */
const LEAD_TIME_CAP_DAYS = 90;

export interface RankScoreBreakdown {
  price: number;
  availability: number;
  leadTime: number;
  lifecycle: number;
  supplier: number;
  total: number;
}

export interface RankedOffer extends OfferEvaluation {
  rank: number;
  score: RankScoreBreakdown;
  /** 全场最低总价(可比报价中) */
  isLowestTotal: boolean;
}

function supplierScore(offer: NormalizedOffer, ctx: RankContext): number {
  const p = offer.supplierPriority ?? ctx.defaultSupplierPriority ?? 100;
  // priority 越小越优先:1 → 1.0;100 → ~0.5;200 → ~0.33
  return 1 / (1 + Math.max(0, p - 1) / 100);
}

/** 浮点噪声会破坏排序稳定性,统一保留 6 位 */
function fix(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function scoreOf(
  evaluation: OfferEvaluation,
  ctx: RankContext,
  bestExtended: Decimal | null,
): RankScoreBreakdown {
  const priceScore =
    evaluation.comparable && evaluation.extendedPrice && bestExtended && evaluation.extendedPrice.gt(0)
      ? Number(bestExtended.div(evaluation.extendedPrice).toFixed(6))
      : 0;
  const availability = evaluation.stockCoverage;
  const lead =
    evaluation.leadTimeDays == null
      ? 0.5 // 交期未知:不奖不罚,取中值
      : 1 - Math.min(evaluation.leadTimeDays, LEAD_TIME_CAP_DAYS) / LEAD_TIME_CAP_DAYS;
  const lifecycle = LIFECYCLE_SCORE[evaluation.offer.lifecycle];
  const supplier = supplierScore(evaluation.offer, ctx);

  const total =
    priceScore * RANK_WEIGHTS.price +
    availability * RANK_WEIGHTS.availability +
    lead * RANK_WEIGHTS.leadTime +
    lifecycle * RANK_WEIGHTS.lifecycle +
    supplier * RANK_WEIGHTS.supplier;

  return {
    price: fix(priceScore),
    availability: fix(availability),
    leadTime: fix(lead),
    lifecycle: fix(lifecycle),
    supplier: fix(supplier),
    total: fix(total),
  };
}

/**
 * 两个报价的比较器(供 rankOffers 与外部排序共用)。
 * 返回 <0 表示 a 更优。排序完全确定:同分时依次比 总价 → 交期 → 供应商优先级 → provider → MPN。
 */
export function compareOffers(
  a: OfferEvaluation & { score: RankScoreBreakdown },
  b: OfferEvaluation & { score: RankScoreBreakdown },
  ctx: RankContext,
): number {
  // 可比者恒优先于不可比者
  if (a.comparable !== b.comparable) return a.comparable ? -1 : 1;
  if (a.score.total !== b.score.total) return b.score.total - a.score.total;

  const ax = a.extendedPrice;
  const bx = b.extendedPrice;
  if (ax && bx && !ax.eq(bx)) return ax.lt(bx) ? -1 : 1;
  if (!!ax !== !!bx) return ax ? -1 : 1;

  const al = a.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
  const bl = b.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
  if (al !== bl) return al - bl;

  const ap = a.offer.supplierPriority ?? ctx.defaultSupplierPriority ?? 100;
  const bp = b.offer.supplierPriority ?? ctx.defaultSupplierPriority ?? 100;
  if (ap !== bp) return ap - bp;

  if (a.offer.provider !== b.offer.provider) return a.offer.provider < b.offer.provider ? -1 : 1;
  if (a.offer.mpn !== b.offer.mpn) return a.offer.mpn < b.offer.mpn ? -1 : 1;
  return 0;
}

/**
 * 报价排名(SPEC §10):综合总金额、库存、需求量、MOQ/SPQ、交期、生命周期与供应商优先级。
 * 输出保留评分明细与不可比原因,供 UI 解释「为什么推荐它」——推荐仍需人工确认。
 */
export function rankOffers(offers: readonly NormalizedOffer[], ctx: RankContext): RankedOffer[] {
  const evaluations = offers.map((o) => evaluateOffer(o, ctx));

  let bestExtended: Decimal | null = null;
  for (const e of evaluations) {
    if (e.comparable && e.extendedPrice && e.extendedPrice.gt(0)) {
      if (!bestExtended || e.extendedPrice.lt(bestExtended)) bestExtended = e.extendedPrice;
    }
  }

  const scored = evaluations.map((e) => ({ ...e, score: scoreOf(e, ctx, bestExtended) }));
  scored.sort((a, b) => compareOffers(a, b, ctx));

  return scored.map((s, i) => ({
    ...s,
    rank: i + 1,
    isLowestTotal: !!(
      s.comparable &&
      s.extendedPrice &&
      bestExtended &&
      s.extendedPrice.eq(bestExtended)
    ),
  }));
}
