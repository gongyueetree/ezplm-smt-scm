/**
 * 分销商 Provider 统一接口(DigiKey / Mouser / 将来其它线上分销)。
 *
 * SPEC §8 纪律的结构化落地:KeywordSearch 只用于「候选」,
 * 因此 searchByKeyword 的返回类型 **不含价格与库存字段** —— 正式价格/库存只能
 * 经 getOffersByMpn(ProductDetails/ProductPricing 等正式接口)获得,
 * 从类型层面杜绝把关键字搜索结果当作报价依据。
 */
import type { ProviderName } from "./errors";
import type { NormalizedOffer } from "./normalized-offer";

/** 候选(仅标识信息,无价格/库存) */
export interface OfferCandidate {
  provider: ProviderName;
  providerPartNumber: string | null;
  mpn: string;
  manufacturer: string | null;
  description: string | null;
  sourceUrl: string | null;
}

export interface GetOffersInput {
  mpn: string;
  manufacturer?: string;
  /** 询价数量,进入缓存键;不传表示只取通用阶梯价 */
  quantity?: number;
}

export interface SearchCandidatesInput {
  keyword: string;
  manufacturer?: string;
  /** 上限;Mouser 单次最多 50(SPEC §9) */
  limit?: number;
}

export interface DistributorProvider {
  readonly name: ProviderName;
  /** 正式价格与库存来源 */
  getOffersByMpn(input: GetOffersInput): Promise<NormalizedOffer[]>;
  /** 候选来源(不得作为价格依据) */
  searchCandidates(input: SearchCandidatesInput): Promise<OfferCandidate[]>;
  /** 替代料(DigiKey Substitutions;Mouser 无对应能力时返回空数组) */
  getSubstitutes(mpn: string): Promise<OfferCandidate[]>;
  /** 推荐料(DigiKey RecommendedProducts;不支持时返回空数组) */
  getRecommended(mpn: string): Promise<OfferCandidate[]>;
}
