/**
 * 多源比价集合与推荐(SPEC §11)。
 *
 * 纪律:
 * - 比价集合按「同一颗料」组织:同 MPN 异厂商不同表(PR4 冒烟教训),
 *   由 rankOffers 的 expectedManufacturer 承担;
 * - 推荐**仅为建议**:采购可选择、修改或拒绝,拒绝推荐必须写理由(SPEC §11);
 * - 现货/期货两种模式对候选的取舍不同,由 sourcingMode 显式区分,不隐式混合。
 */
import { rankOffers, type RankedOffer, type RankContext } from "./offers";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";

export type SourcingModeValue = "SPOT" | "FUTURES";

export interface ComparisonInput {
  /** 目标料:比价集合以此为准,异厂商报价会被标注不可比 */
  mpn: string;
  manufacturer?: string | null;
  demandQty: number;
  currency: string;
  mode: SourcingModeValue;
  offers: readonly NormalizedOffer[];
}

export interface ComparisonSet {
  mpn: string;
  manufacturer: string | null;
  mode: SourcingModeValue;
  currency: string;
  demandQty: number;
  ranked: RankedOffer[];
  /** 可比且满足模式约束的报价 */
  eligible: RankedOffer[];
  /** 被排除的报价及原因(诚实展示,不静默丢弃) */
  excluded: { offer: RankedOffer; reason: string }[];
  recommended: RankedOffer | null;
  lowestTotal: RankedOffer | null;
}

/**
 * 现货模式:必须当下有货(库存 ≥ 采购量);期货模式:允许零库存但必须有交期。
 * 两种模式都不接受"既无库存又无交期"的报价 —— 那不是可执行的供应。
 */
function modeEligibility(
  offer: RankedOffer,
  mode: SourcingModeValue,
): { ok: boolean; reason?: string } {
  if (mode === "SPOT") {
    if (!offer.stockCovered) {
      return {
        ok: false,
        reason: `现货模式要求库存覆盖采购量(库存 ${offer.offer.stock ?? "未知"} < 采购量 ${offer.purchaseQty})`,
      };
    }
    return { ok: true };
  }
  if (!offer.stockCovered && offer.leadTimeDays === null) {
    return { ok: false, reason: "期货模式要求提供交期,该报价既无库存也无交期" };
  }
  return { ok: true };
}

/** 构建比价集合(SPEC §11:展示全部供应商报价 + 标识最低价与推荐) */
export function buildComparisonSet(input: ComparisonInput): ComparisonSet {
  const ctx: RankContext = {
    demandQty: input.demandQty,
    currency: input.currency,
    expectedManufacturer: input.manufacturer ?? undefined,
  };
  const ranked = rankOffers(input.offers, ctx);

  const eligible: RankedOffer[] = [];
  const excluded: { offer: RankedOffer; reason: string }[] = [];

  for (const r of ranked) {
    if (!r.comparable) {
      excluded.push({
        offer: r,
        reason:
          r.incomparableReason === "manufacturer_mismatch"
            ? "同号异厂料,不是同一颗料"
            : r.incomparableReason === "currency_mismatch"
              ? "币种与比价口径不同,系统不做汇率换算"
              : "圆整后取不到适用阶梯价",
      });
      continue;
    }
    const m = modeEligibility(r, input.mode);
    if (!m.ok) {
      excluded.push({ offer: r, reason: m.reason! });
      continue;
    }
    eligible.push(r);
  }

  return {
    mpn: input.mpn,
    manufacturer: input.manufacturer ?? null,
    mode: input.mode,
    currency: input.currency,
    demandQty: input.demandQty,
    ranked,
    eligible,
    excluded,
    // 推荐 = 合格集合中排名最优者(综合价格/库存/交期/生命周期/供应商优先级)
    recommended: eligible[0] ?? null,
    // 最低总价单独标识:提醒采购"最便宜的未必是推荐的",差异需人工判断
    lowestTotal: eligible.find((e) => e.isLowestTotal) ?? null,
  };
}

export interface SelectionInput {
  /** 采购最终选定的报价标识(provider + providerPartNumber 或行 id) */
  selectedKey: string | null;
  /** 推荐的报价标识 */
  recommendedKey: string | null;
  reason?: string | null;
}

export type SelectionError =
  | { code: "no_selection"; message: string }
  | { code: "reason_required"; message: string };

/**
 * 校验采购选型(SPEC §11:采购可以选择、修改或拒绝推荐;保存选择理由)。
 * 与推荐不一致时**必须**写理由 —— 这是把"为什么不选最优"留痕的唯一手段。
 */
export function validateSelection(input: SelectionInput): {
  ok: boolean;
  errors: SelectionError[];
  overrodeRecommendation: boolean;
} {
  const errors: SelectionError[] = [];
  if (!input.selectedKey) {
    return {
      ok: false,
      errors: [{ code: "no_selection", message: "必须选择一个供应商报价" }],
      overrodeRecommendation: false,
    };
  }
  const overrode = !!input.recommendedKey && input.selectedKey !== input.recommendedKey;
  if (overrode && !input.reason?.trim()) {
    errors.push({
      code: "reason_required",
      message: "选择与系统推荐不一致时,必须填写选择理由",
    });
  }
  return { ok: errors.length === 0, errors, overrodeRecommendation: overrode };
}
