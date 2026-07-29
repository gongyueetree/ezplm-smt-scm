/**
 * 市场行情汇总(纯函数,可完全单测)。
 *
 * 把若干分销商报价汇总成"这颗料现在多少钱、好不好买":
 * 阶梯价、可得性、供货渠道。
 *
 * 纪律:
 * - **不做汇率换算**,异币种各自成组 —— 系统全局都是这条规则;
 * - **库存未知 ≠ 无货**:未知就是未知,不能显示成"无货"吓退采购;
 * - 供货档位是**启发式判断**,UI 必须标注它是估算而不是承诺;
 * - 显示的是各源的**数据更新时间**,不暗示实时行情。
 */
import Decimal from "decimal.js";
import { getApplicablePriceBreak } from "./offers";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";

export type Availability = "充足" | "一般" | "紧张" | "无现货" | "未知";

export interface TierPrice {
  qty: number;
  unitPrice: string;
  currency: string;
  provider: string;
}

export interface MarketSummary {
  /** 各数量档的最优价(同币种内比较,不跨币种) */
  tiers: TierPrice[];
  availability: Availability;
  /** 各源库存之和;全为未知时是 null */
  totalStock: number | null;
  /** 有货的渠道名 */
  channels: string[];
  /** 各源数据更新时间里最早的一个(诚实展示口径) */
  dataUpdatedAt: string | null;
  /** 币种不一致时为 true,UI 需提示不可直接比较 */
  mixedCurrency: boolean;
}

/**
 * 供货档位。阈值相对于**需求量**而不是绝对值 ——
 * 库存 5000 对样品单是充足,对 10 万台的量产就是紧张。
 */
export function availabilityLabel(
  totalStock: number | null,
  demandQty = 1,
): Availability {
  if (totalStock === null) return "未知";
  if (totalStock <= 0) return "无现货";
  const need = Math.max(demandQty, 1);
  if (totalStock >= need * 10) return "充足";
  if (totalStock >= need * 2) return "一般";
  return "紧张";
}

/** 取某个数量档的最低价;同币种内比较,不跨币种换算 */
export function bestPriceAtQty(
  offers: readonly NormalizedOffer[],
  qty: number,
): TierPrice | null {
  let best: { price: Decimal; tier: TierPrice } | null = null;
  for (const o of offers) {
    const pb = getApplicablePriceBreak(o.priceBreaks, qty);
    if (!pb) continue;
    let price: Decimal;
    try {
      price = new Decimal(pb.unitPrice);
    } catch {
      continue;
    }
    if (price.lte(0)) continue;
    // 只在**同币种**里比大小;不同币种各自都可能成为"最优",
    // 这里取先到的那一个并由 mixedCurrency 标注,不做换算
    if (best === null || (best.tier.currency === o.currency && price.lt(best.price))) {
      best = {
        price,
        tier: { qty, unitPrice: pb.unitPrice, currency: o.currency, provider: o.provider },
      };
    }
  }
  return best?.tier ?? null;
}

export function summarizeMarket(
  offers: readonly NormalizedOffer[],
  options: { tiers?: number[]; demandQty?: number } = {},
): MarketSummary {
  const tiers = options.tiers ?? [1, 100];

  const stocks = offers.map((o) => o.stock).filter((s): s is number => s !== null);
  const totalStock = stocks.length > 0 ? stocks.reduce((a, b) => a + b, 0) : null;

  const channels = [
    ...new Set(offers.filter((o) => (o.stock ?? 0) > 0).map((o) => o.provider)),
  ];

  const updatedAts = offers
    .map((o) => o.sourceUpdatedAt)
    .filter((v): v is string => Boolean(v))
    .sort();

  const currencies = new Set(offers.map((o) => o.currency));

  return {
    tiers: tiers
      .map((q) => bestPriceAtQty(offers, q))
      .filter((t): t is TierPrice => t !== null),
    availability: availabilityLabel(totalStock, options.demandQty),
    totalStock,
    channels,
    dataUpdatedAt: updatedAts[0] ?? null,
    mixedCurrency: currencies.size > 1,
  };
}
