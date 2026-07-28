/**
 * DigiKeyProvider(SPEC §8,Product Information V4)。
 *
 * 纪律落地:
 * - KeywordSearch 只产出候选(searchCandidates 返回 OfferCandidate,类型上无价格/库存);
 *   正式价格与库存只走 ProductDetails / ProductPricing。
 * - Account ID 与 Locale(Site/Language/Currency)全部可配置,经 Header 传递。
 * - 429 重试、X-RateLimit 记录、超时/熔断由 ProviderHttpClient 统一处理。
 * - 相同 MPN 去重经 dedupeOffers。
 * - Client ID/Secret 与 access_token 仅存服务端,不进日志与错误消息。
 *
 * ⚠ 联调状态:响应契约依据 DigiKey V4 公开文档实现,本地夹具验证通过;
 *   与真实 DigiKey 环境的联调需在配置真实凭据后执行冒烟脚本确认。
 */
import { dedupeOffers } from "../common/dedupe";
import type {
  DistributorProvider,
  GetOffersInput,
  OfferCandidate,
  SearchCandidatesInput,
} from "../common/distributor";
import { ProviderError } from "../common/errors";
import { ProviderHttpClient } from "../common/http-client";
import type { ApiUsageRecorder } from "../common/api-usage";
import { manufacturerMatches } from "../common/mpn";
import type { NormalizedOffer, NormalizedPriceBreak } from "../common/normalized-offer";
import {
  parseCompliance,
  parseLeadTimeDays,
  parseLifecycle,
  toDecimalString,
} from "../common/parse";
import { DigiKeyAuthService, DigiKeyTokenStore } from "./auth";
import {
  DkKeywordSearchResponseSchema,
  DkProductDetailsResponseSchema,
  DkProductPricingResponseSchema,
  DkRecommendedResponseSchema,
  DkSubstitutionsResponseSchema,
  type DkProduct,
} from "./types";

export interface DigiKeyConfig {
  baseUrl?: string;
  clientId: string;
  clientSecret: string;
  accountId?: string;
  site?: string;
  language?: string;
  currency?: string;
}

export interface DigiKeyProviderOptions extends DigiKeyConfig {
  timeoutMs?: number;
  retries?: number;
  retryBaseMs?: number;
  breaker?: { failureThreshold?: number; cooldownMs?: number; now?: () => number };
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  usageRecorder?: ApiUsageRecorder;
  authService?: DigiKeyAuthService;
  /** 注入固定时间,便于测试 sourceUpdatedAt */
  nowDate?: () => Date;
}

export const DIGIKEY_DEFAULT_BASE_URL = "https://api.digikey.com";

export class DigiKeyProvider implements DistributorProvider {
  readonly name = "DIGIKEY" as const;
  private readonly http: ProviderHttpClient;
  private readonly auth: DigiKeyAuthService;
  private readonly site: string;
  private readonly language: string;
  private readonly currency: string;
  private readonly accountId?: string;
  private readonly nowDate: () => Date;

  constructor(opts: DigiKeyProviderOptions) {
    const baseUrl = opts.baseUrl ?? DIGIKEY_DEFAULT_BASE_URL;
    this.site = (opts.site ?? "CN").toUpperCase();
    this.language = opts.language ?? "zh";
    this.currency = (opts.currency ?? "CNY").toUpperCase();
    this.accountId = opts.accountId;
    this.nowDate = opts.nowDate ?? (() => new Date());

    this.auth =
      opts.authService ??
      new DigiKeyAuthService({
        baseUrl,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs,
      });

    this.http = new ProviderHttpClient({
      provider: "DIGIKEY",
      baseUrl,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      retryBaseMs: opts.retryBaseMs,
      breaker: opts.breaker,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      usageRecorder: opts.usageRecorder,
      prepare: async (init) => {
        const token = await this.auth.getAccessToken();
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          "X-DIGIKEY-Client-Id": opts.clientId,
          "X-DIGIKEY-Locale-Site": this.site,
          "X-DIGIKEY-Locale-Language": this.language,
          "X-DIGIKEY-Locale-Currency": this.currency,
          "Content-Type": "application/json",
          ...(init.headers as Record<string, string> | undefined),
        };
        if (this.accountId) headers["X-DIGIKEY-Customer-Id"] = this.accountId;
        return { ...init, headers };
      },
      // token 失效时清缓存并重试一次(SPEC §8:自动刷新)
      onUnauthorized: () => this.auth.tokenStore.clear(),
    });
  }

  /** 诊断用非敏感状态(永不含 token) */
  tokenStatus() {
    return this.auth.tokenStore.status();
  }

  // ===== 正式价格/库存:ProductDetails(+ ProductPricing 兜底)=====

  async getOffersByMpn(input: GetOffersInput): Promise<NormalizedOffer[]> {
    const path = `/products/v4/search/${encodeURIComponent(input.mpn)}/productdetails`;
    const res = await this.http.request(DkProductDetailsResponseSchema, path, { method: "GET" });
    const product = res.Product;
    if (!product) return [];
    if (!manufacturerMatches(product.Manufacturer?.Name, input.manufacturer)) return [];

    let offers = this.toOffers(product);
    // 详情未带阶梯价时,退到 ProductPricing 正式取价(仍非 KeywordSearch)
    if (offers.every((o) => o.priceBreaks.length === 0)) {
      const pricing = await this.getPricing(input.mpn).catch((e) => {
        if (e instanceof ProviderError) return null; // 取价失败不掩盖详情结果
        throw e;
      });
      if (pricing && pricing.length > 0) offers = pricing;
    }
    return dedupeOffers(offers);
  }

  /** GET /pricing:仅取阶梯价与库存,合并回 NormalizedOffer */
  async getPricing(mpn: string): Promise<NormalizedOffer[]> {
    const path = `/products/v4/search/${encodeURIComponent(mpn)}/pricing`;
    const res = await this.http.request(DkProductPricingResponseSchema, path, { method: "GET" });
    const product = res.Product;
    if (!product) return [];
    return this.toOffers({
      ManufacturerProductNumber: product.ManufacturerProductNumber ?? mpn,
      ProductVariations: product.ProductVariations,
    } as DkProduct);
  }

  // ===== 候选:KeywordSearch / Substitutions / RecommendedProducts =====

  async searchCandidates(input: SearchCandidatesInput): Promise<OfferCandidate[]> {
    const res = await this.http.request(DkKeywordSearchResponseSchema, "/products/v4/search/keyword", {
      method: "POST",
      body: JSON.stringify({
        Keywords: input.manufacturer ? `${input.manufacturer} ${input.keyword}` : input.keyword,
        Limit: Math.min(input.limit ?? 20, 50),
        Offset: 0,
      }),
    });
    const products = [...(res.ExactMatches ?? []), ...(res.Products ?? [])];
    return this.dedupeCandidates(products.map((p) => this.toCandidate(p)));
  }

  async getSubstitutes(mpn: string): Promise<OfferCandidate[]> {
    const path = `/products/v4/search/${encodeURIComponent(mpn)}/substitutions`;
    const res = await this.http.request(DkSubstitutionsResponseSchema, path, { method: "GET" });
    return this.dedupeCandidates((res.ProductSubstitutes ?? []).map((p) => this.toCandidate(p)));
  }

  async getRecommended(mpn: string): Promise<OfferCandidate[]> {
    const path = `/products/v4/search/${encodeURIComponent(mpn)}/recommendedproducts`;
    const res = await this.http.request(DkRecommendedResponseSchema, path, { method: "GET" });
    const products = res.RecommendedProducts ?? res.Products ?? [];
    return this.dedupeCandidates(products.map((p) => this.toCandidate(p)));
  }

  // ===== 归一化 =====

  private dedupeCandidates(list: OfferCandidate[]): OfferCandidate[] {
    const seen = new Set<string>();
    return list.filter((c) => {
      const k = c.mpn.toUpperCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  private toCandidate(p: DkProduct): OfferCandidate {
    return {
      provider: "DIGIKEY",
      providerPartNumber: p.ProductVariations?.[0]?.DigiKeyProductNumber ?? null,
      mpn: p.ManufacturerProductNumber,
      manufacturer: p.Manufacturer?.Name ?? null,
      description: p.Description?.ProductDescription ?? null,
      sourceUrl: p.ProductUrl ?? null,
    };
  }

  /** 每个包装形态(Cut Tape / T&R …)各成一条报价:MOQ/SPQ/阶梯价随包装不同 */
  private toOffers(p: DkProduct): NormalizedOffer[] {
    // sourceUpdatedAt 语义:本次抓取时间(DigiKey 未提供数据版本时间戳),
    // UI 据此显示「数据更新时间」,不得表述为实时价格。
    const fetchedAt = this.nowDate().toISOString();
    const variations = p.ProductVariations ?? [];
    const base = {
      provider: "DIGIKEY" as const,
      mpn: p.ManufacturerProductNumber,
      manufacturer: p.Manufacturer?.Name ?? null,
      description: p.Description?.ProductDescription ?? null,
      lifecycle: parseLifecycle(p.ProductStatus?.Status),
      rohs: parseCompliance(p.Classifications?.RohsStatus),
      reach: parseCompliance(p.Classifications?.ReachStatus),
      currency: this.currency,
      leadTimeDays: parseLeadTimeDays(p.ManufacturerLeadWeeks ?? null),
      sourceUpdatedAt: fetchedAt,
      sourceUrl: p.ProductUrl ?? null,
    };

    if (variations.length === 0) {
      return [
        {
          ...base,
          providerPartNumber: null,
          packaging: null,
          stock: p.QuantityAvailable ?? null,
          moq: null,
          spq: null,
          priceBreaks: [],
        },
      ];
    }

    return variations.map((v) => {
      const priceBreaks: NormalizedPriceBreak[] = (v.StandardPricing ?? []).flatMap((b) => {
        const unitPrice = toDecimalString(b.UnitPrice);
        if (unitPrice === null || !Number.isFinite(b.BreakQuantity)) return [];
        return [{ minQty: Math.max(0, Math.trunc(b.BreakQuantity)), unitPrice }];
      });
      priceBreaks.sort((a, b) => a.minQty - b.minQty);
      return {
        ...base,
        providerPartNumber: v.DigiKeyProductNumber ?? null,
        packaging: v.PackageType?.Name ?? null,
        stock: v.QuantityAvailableforPackageType ?? p.QuantityAvailable ?? null,
        moq: v.MinimumOrderQuantity ?? null,
        spq: v.StandardPackage ?? null,
        priceBreaks,
      };
    });
  }
}

export { DigiKeyAuthService, DigiKeyTokenStore };
