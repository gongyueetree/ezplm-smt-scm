/**
 * 外部 API 用量记录(SPEC §8:记录 X-RateLimit;schema:ApiUsageLog)。
 * 端点必须已脱敏(redactUrl),禁止写入任何 Key 明文。
 */
import type { ProviderName } from "./errors";

export interface ApiUsageRecord {
  provider: ProviderName;
  /** 已脱敏端点 */
  endpoint: string;
  statusCode?: number;
  rateLimitLimit?: number;
  rateLimitRemaining?: number;
  durationMs?: number;
}

export interface ApiUsageRecorder {
  record(usage: ApiUsageRecord): void;
}

/** 默认不记录(单测与无租户上下文场景);业务侧注入 Prisma 实现 */
export const noopUsageRecorder: ApiUsageRecorder = { record: () => {} };

/** 从响应头提取限流信息(DigiKey/Mouser 均使用 X-RateLimit-* 约定) */
export function readRateLimitHeaders(headers: Headers): {
  rateLimitLimit?: number;
  rateLimitRemaining?: number;
} {
  const num = (v: string | null) => {
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    rateLimitLimit: num(headers.get("x-ratelimit-limit")),
    rateLimitRemaining: num(headers.get("x-ratelimit-remaining")),
  };
}
