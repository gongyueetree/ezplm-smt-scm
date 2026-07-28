/**
 * MouserRateLimiter(SPEC §9):每分钟限流 + 每日配额。
 * 时钟可注入,行为完全确定,便于单测。
 *
 * 语义:
 * - 分钟窗口用满 → 返回 wait(建议等待毫秒),由调用方退避后重试;
 * - 日配额用尽 → 返回 quota(不可重试,当日不再放行),转 quota_exceeded 结构化错误。
 */

export interface MouserRateLimiterOptions {
  /** 每分钟最大调用数 */
  perMinute?: number;
  /** 每日配额 */
  perDay?: number;
  now?: () => number;
}

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; reason: "minute"; retryAfterMs: number }
  | { ok: false; reason: "quota"; retryAfterMs: number };

export class MouserRateLimiter {
  private readonly perMinute: number;
  private readonly perDay: number;
  private readonly now: () => number;
  private minuteWindowStart = 0;
  private minuteCount = 0;
  private dayWindowStart = 0;
  private dayCount = 0;

  constructor(opts: MouserRateLimiterOptions = {}) {
    // Mouser 公开限制:单次最多 50 条、约 30 次/分钟、1000 次/日
    this.perMinute = opts.perMinute ?? 30;
    this.perDay = opts.perDay ?? 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** 尝试占用一次调用额度 */
  acquire(): RateLimitDecision {
    const t = this.now();
    if (t - this.dayWindowStart >= 86_400_000) {
      this.dayWindowStart = t;
      this.dayCount = 0;
    }
    if (t - this.minuteWindowStart >= 60_000) {
      this.minuteWindowStart = t;
      this.minuteCount = 0;
    }
    if (this.dayCount >= this.perDay) {
      return {
        ok: false,
        reason: "quota",
        retryAfterMs: this.dayWindowStart + 86_400_000 - t,
      };
    }
    if (this.minuteCount >= this.perMinute) {
      return {
        ok: false,
        reason: "minute",
        retryAfterMs: this.minuteWindowStart + 60_000 - t,
      };
    }
    this.minuteCount += 1;
    this.dayCount += 1;
    return { ok: true };
  }

  /** 非敏感状态(诊断页用) */
  status(): { minuteUsed: number; minuteLimit: number; dayUsed: number; dayLimit: number } {
    return {
      minuteUsed: this.minuteCount,
      minuteLimit: this.perMinute,
      dayUsed: this.dayCount,
      dayLimit: this.perDay,
    };
  }
}
