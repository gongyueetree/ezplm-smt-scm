/**
 * MouserProvider(SPEC §9)。
 *
 * 纪律落地:
 * - 四种检索:partnumber / keyword / partnumberandmanufacturer / keywordandmanufacturer;
 * - 单次最多 50 条;每分钟限流 + 每日配额经 MouserRateLimiter 前置拦截;
 * - 429/5xx 退避重试由 ProviderHttpClient 处理;
 * - API Key 走 query(Mouser 规定),因此所有日志/错误端点一律 redactUrl 脱敏;
 * - 关键字检索只产出候选(无价格/库存),正式报价走 partnumber 检索。
 *
 * ⚠ 联调状态:响应契约依据 Mouser Search API v1 公开文档实现,本地夹具验证通过;
 *   与真实 Mouser 环境的联调需在配置真实 Key 后执行冒烟脚本确认。
 */
import type { ApiUsageRecorder } from "../common/api-usage";
import { dedupeOffers } from "../common/dedupe";
import type {
  DistributorProvider,
  GetOffersInput,
  OfferCandidate,
  SearchCandidatesInput,
} from "../common/distributor";
import { ProviderError } from "../common/errors";
import { ProviderHttpClient } from "../common/http-client";
import { manufacturerMatches, mpnEquals } from "../common/mpn";
import type { NormalizedOffer, NormalizedPriceBreak } from "../common/normalized-offer";
import {
  parseCompliance,
  parseLeadTimeDays,
  parseLifecycle,
  parseMoneyString,
  parseQuantity,
} from "../common/parse";
import { MouserRateLimiter } from "./rate-limiter";
import { MouserSearchResponseSchema, type MouserPart } from "./types";

export const MOUSER_DEFAULT_BASE_URL = "https://api.mouser.com";
/** SPEC §9:每次最多 50 结果 */
export const MOUSER_MAX_RECORDS = 50;

export interface MouserProviderOptions {
  apiKey: string;
  baseUrl?: string;
  currency?: string;
  timeoutMs?: number;
  retries?: number;
  retryBaseMs?: number;
  breaker?: { failureThreshold?: number; cooldownMs?: number; now?: () => number };
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  usageRecorder?: ApiUsageRecorder;
  rateLimiter?: MouserRateLimiter;
  nowDate?: () => Date;
}

export class MouserProvider implements DistributorProvider {
  readonly name = "MOUSER" as const;
  private readonly http: ProviderHttpClient;
  private readonly limiter: MouserRateLimiter;
  private readonly apiKey: string;
  private readonly currency: string;
  private readonly nowDate: () => Date;

  constructor(opts: MouserProviderOptions) {
    if (!opts.apiKey) throw new Error("MOUSER_API_KEY 缺失(仅服务端环境变量)");
    this.apiKey = opts.apiKey;
    this.currency = (opts.currency ?? "CNY").toUpperCase();
    this.limiter = opts.rateLimiter ?? new MouserRateLimiter();
    this.nowDate = opts.nowDate ?? (() => new Date());
    this.http = new ProviderHttpClient({
      provider: "MOUSER",
      baseUrl: opts.baseUrl ?? MOUSER_DEFAULT_BASE_URL,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      retryBaseMs: opts.retryBaseMs,
      breaker: opts.breaker,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      usageRecorder: opts.usageRecorder,
      prepare: (init) => ({
        ...init,
        headers: { "Content-Type": "application/json", ...init.headers },
      }),
    });
  }

  rateLimitStatus() {
    return this.limiter.status();
  }

  /** 限流前置:分钟窗口满 → rate_limited(可重试);日配额满 → quota_exceeded(当日不可重试) */
  private guardRateLimit(endpoint: string): void {
    const decision = this.limiter.acquire();
    if (decision.ok) return;
    if (decision.reason === "quota") {
      throw new ProviderError("MOUSER", "quota_exceeded", `Mouser 当日配额已用尽:${endpoint}`, {
        retriable: false,
        retryAfterMs: decision.retryAfterMs,
      });
    }
    throw new ProviderError("MOUSER", "rate_limited", `Mouser 每分钟限流:${endpoint}`, {
      retriable: true,
      retryAfterMs: decision.retryAfterMs,
    });
  }

  private path(op: string): string {
    // Mouser 规定 apiKey 走 query;日志/错误经 redactUrl 脱敏后才输出
    return `/api/v1/search/${op}?apiKey=${encodeURIComponent(this.apiKey)}`;
  }

  private async search(op: string, body: unknown): Promise<MouserPart[]> {
    this.guardRateLimit(`/api/v1/search/${op}`);
    const res = await this.http.request(MouserSearchResponseSchema, this.path(op), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const errors = (res.Errors ?? []).filter((e) => e.Message || e.Code);
    if (errors.length > 0) {
      // Mouser 以 HTTP 200 + Errors 报错,必须显式转结构化错误,不得当作空结果
      throw new ProviderError(
        "MOUSER",
        "http",
        `Mouser 返回错误:${errors.map((e) => e.Message ?? e.Code).join("; ")}`,
        { retriable: false },
      );
    }
    return res.SearchResults?.Parts ?? [];
  }

  // ===== 正式价格/库存:partnumber / partnumberandmanufacturer =====

  async getOffersByMpn(input: GetOffersInput): Promise<NormalizedOffer[]> {
    const parts = input.manufacturer
      ? await this.search("partnumberandmanufacturer", {
          SearchByPartMfrNameRequest: {
            manufacturerName: input.manufacturer,
            mouserPartNumber: input.mpn,
          },
        })
      : await this.search("partnumber", {
          SearchByPartRequest: {
            mouserPartNumber: input.mpn,
            partSearchOptions: "Exact",
          },
        });

    // Mouser 的 partnumber 检索可能返回近似项;MPN 必须严格一致,
    // 制造商也在本地复核一次(不完全信任三方的服务端过滤)
    const offers = parts
      .filter(
        (p) =>
          mpnEquals(p.ManufacturerPartNumber, input.mpn) &&
          manufacturerMatches(p.Manufacturer, input.manufacturer),
      )
      .map((p) => this.toOffer(p));
    return dedupeOffers(offers);
  }

  // ===== 候选:keyword / keywordandmanufacturer =====

  async searchCandidates(input: SearchCandidatesInput): Promise<OfferCandidate[]> {
    const records = Math.min(input.limit ?? 20, MOUSER_MAX_RECORDS);
    const parts = input.manufacturer
      ? await this.search("keywordandmanufacturer", {
          SearchByKeywordMfrNameRequest: {
            manufacturerName: input.manufacturer,
            keyword: input.keyword,
            records,
            startingRecord: 0,
          },
        })
      : await this.search("keyword", {
          SearchByKeywordRequest: {
            keyword: input.keyword,
            records,
            startingRecord: 0,
          },
        });
    return parts.slice(0, records).map((p) => this.toCandidate(p));
  }

  /** Mouser Search API 无替代料能力,按接口契约返回空数组(不伪造) */
  async getSubstitutes(): Promise<OfferCandidate[]> {
    return [];
  }

  /** Mouser Search API 无推荐料能力,按接口契约返回空数组(不伪造) */
  async getRecommended(): Promise<OfferCandidate[]> {
    return [];
  }

  // ===== 归一化 =====

  private toCandidate(p: MouserPart): OfferCandidate {
    return {
      provider: "MOUSER",
      providerPartNumber: p.MouserPartNumber ?? null,
      mpn: p.ManufacturerPartNumber,
      manufacturer: p.Manufacturer ?? null,
      description: p.Description ?? null,
      sourceUrl: p.ProductDetailUrl ?? null,
    };
  }

  private toOffer(p: MouserPart): NormalizedOffer {
    const priceBreaks: NormalizedPriceBreak[] = (p.PriceBreaks ?? []).flatMap((b) => {
      const unitPrice = parseMoneyString(b.Price);
      if (unitPrice === null || !Number.isFinite(b.Quantity)) return [];
      return [{ minQty: Math.max(0, Math.trunc(b.Quantity)), unitPrice }];
    });
    priceBreaks.sort((a, b) => a.minQty - b.minQty);

    // 币种以报价行自带为准(Mouser 按站点返回),缺省回落到配置币种
    const currency = (p.PriceBreaks ?? []).find((b) => b.Currency)?.Currency ?? this.currency;

    return {
      provider: "MOUSER",
      providerPartNumber: p.MouserPartNumber ?? null,
      manufacturer: p.Manufacturer ?? null,
      mpn: p.ManufacturerPartNumber,
      description: p.Description ?? null,
      packaging: p.PackagingOptions?.[0] ?? null,
      stock: parseQuantity(p.Availability),
      moq: parseQuantity(p.Min),
      spq: parseQuantity(p.Mult),
      leadTimeDays: parseLeadTimeDays(p.LeadTime),
      lifecycle: parseLifecycle(p.LifecycleStatus ?? p.ProductStatus),
      rohs: parseCompliance(p.ROHSStatus),
      reach: parseCompliance(p.ReachStatus),
      currency: currency.toUpperCase().slice(0, 3),
      priceBreaks,
      // 抓取时间(Mouser 未提供数据版本时间戳);UI 据此显示「数据更新时间」
      sourceUpdatedAt: this.nowDate().toISOString(),
      sourceUrl: p.ProductDetailUrl ?? null,
    };
  }
}
