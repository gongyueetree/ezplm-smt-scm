/**
 * 外部 API 缓存(SPEC §15)。
 * Cache Key = provider + site + currency + mpn + manufacturer + quantity。
 * TTL:价格/库存 15–30 分钟;规格/生命周期/合规 24 小时。
 *
 * 缓存内容落 ExternalPartSnapshot(schema 已有);本文件只提供键与 TTL 策略 + 存储抽象,
 * Prisma 实现走 tenant 守卫(CLAUDE.md 数据访问约定)。
 */
import { normalizeManufacturer, normalizeMpn } from "./mpn";
import type { ProviderTypeValue } from "./normalized-offer";

/** TTL 常量(秒) */
export const CACHE_TTL_SECONDS = {
  /** 价格/库存:取 SPEC 建议区间下限 15 分钟,保证比价页数据新鲜度 */
  PRICE_STOCK: 15 * 60,
  /** 规格/生命周期/合规:24 小时 */
  SPEC_LIFECYCLE_COMPLIANCE: 24 * 60 * 60,
} as const;

export interface OfferCacheKeyInput {
  provider: ProviderTypeValue;
  /** 站点/地区(如 DigiKey 的 CN);无站点概念的 provider 传 null */
  site: string | null;
  currency: string;
  mpn: string;
  manufacturer?: string | null;
  /** 询价数量;不区分数量的查询(规格/合规)传 null */
  quantity?: number | null;
}

/** 生成确定性缓存键:大小写与分隔符差异不产生重复缓存 */
export function buildOfferCacheKey(input: OfferCacheKeyInput): string {
  return [
    input.provider,
    (input.site ?? "-").toUpperCase(),
    input.currency.toUpperCase(),
    normalizeMpn(input.mpn) || "-",
    normalizeManufacturer(input.manufacturer) || "-",
    input.quantity == null ? "-" : String(input.quantity),
  ].join("|");
}

export interface CacheEntry<T> {
  value: T;
  fetchedAt: Date;
  ttlSeconds: number;
}

export interface OfferCache {
  get<T>(tenantId: string, provider: ProviderTypeValue, cacheKey: string): Promise<CacheEntry<T> | null>;
  set<T>(
    tenantId: string,
    provider: ProviderTypeValue,
    cacheKey: string,
    value: T,
    ttlSeconds: number,
  ): Promise<void>;
}

export function isExpired(entry: CacheEntry<unknown>, now: Date = new Date()): boolean {
  return now.getTime() >= entry.fetchedAt.getTime() + entry.ttlSeconds * 1000;
}

/** 进程内缓存(测试与单机开发用;多实例部署以 Prisma 实现为准) */
export class InMemoryOfferCache implements OfferCache {
  private store = new Map<string, CacheEntry<unknown>>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  private k(tenantId: string, provider: ProviderTypeValue, cacheKey: string) {
    return `${tenantId}::${provider}::${cacheKey}`;
  }

  async get<T>(tenantId: string, provider: ProviderTypeValue, cacheKey: string) {
    const hit = this.store.get(this.k(tenantId, provider, cacheKey)) as CacheEntry<T> | undefined;
    if (!hit) return null;
    if (isExpired(hit, this.now())) {
      this.store.delete(this.k(tenantId, provider, cacheKey));
      return null;
    }
    return hit;
  }

  async set<T>(
    tenantId: string,
    provider: ProviderTypeValue,
    cacheKey: string,
    value: T,
    ttlSeconds: number,
  ) {
    this.store.set(this.k(tenantId, provider, cacheKey), {
      value,
      fetchedAt: this.now(),
      ttlSeconds,
    });
  }
}
