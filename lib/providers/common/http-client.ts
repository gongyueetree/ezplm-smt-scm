/**
 * Provider 共用 HTTP 客户端:超时 + 退避重试 + 熔断 + Zod 校验 + 用量记录 + 端点脱敏。
 * ezPLM / DigiKey / Mouser 三方共用同一套失败语义,便于统一降级与观测。
 *
 * ⚠ 安全:进入 message / ApiUsageLog 的端点一律经 redactUrl();
 * 请求头与请求体(可能含 Key)绝不进入任何输出。
 */
import type { z } from "zod";
import { readRateLimitHeaders, noopUsageRecorder, type ApiUsageRecorder } from "./api-usage";
import { CircuitBreaker } from "./circuit-breaker";
import { ProviderError, redactUrl, type ProviderName } from "./errors";

export interface ProviderHttpClientOptions {
  provider: ProviderName;
  baseUrl: string;
  timeoutMs?: number;
  /** 429/5xx/网络错误的最大重试次数 */
  retries?: number;
  /** 退避基数;第 n 次重试等待 base * 2^(n-1) */
  retryBaseMs?: number;
  breaker?: { failureThreshold?: number; cooldownMs?: number; now?: () => number };
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  usageRecorder?: ApiUsageRecorder;
  now?: () => number;
  /** 每次请求前注入鉴权头(如 Bearer token);抛错即中断本次请求 */
  prepare?: (init: RequestInit) => Promise<RequestInit> | RequestInit;
  /** 收到 401 时的回调(清 token),之后允许额外重试一次 */
  onUnauthorized?: () => void | Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ProviderHttpClient {
  private readonly provider: ProviderName;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseMs: number;
  private readonly breaker: CircuitBreaker;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly usage: ApiUsageRecorder;
  private readonly now: () => number;

  constructor(private readonly opts: ProviderHttpClientOptions) {
    this.provider = opts.provider;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.retries = opts.retries ?? 2;
    this.retryBaseMs = opts.retryBaseMs ?? 300;
    this.breaker = new CircuitBreaker({
      failureThreshold: opts.breaker?.failureThreshold ?? 5,
      cooldownMs: opts.breaker?.cooldownMs ?? 30_000,
      now: opts.breaker?.now,
    });
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.usage = opts.usageRecorder ?? noopUsageRecorder;
    this.now = opts.now ?? (() => Date.now());
  }

  private async attempt(url: URL, init: RequestInit, safeEndpoint: string): Promise<Response> {
    const prepared = this.opts.prepare ? await this.opts.prepare(init) : init;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const startedAt = this.now();
    try {
      const res = await this.fetchImpl(url, { ...prepared, signal: ctrl.signal });
      this.usage.record({
        provider: this.provider,
        endpoint: safeEndpoint,
        statusCode: res.status,
        durationMs: this.now() - startedAt,
        ...readRateLimitHeaders(res.headers),
      });
      return res;
    } catch (cause) {
      this.usage.record({
        provider: this.provider,
        endpoint: safeEndpoint,
        durationMs: this.now() - startedAt,
      });
      if (ctrl.signal.aborted) {
        throw new ProviderError(
          this.provider,
          "timeout",
          `${this.provider} 请求超时(${this.timeoutMs}ms): ${safeEndpoint}`,
          { retriable: true, cause },
        );
      }
      throw new ProviderError(
        this.provider,
        "network",
        `${this.provider} 网络错误: ${safeEndpoint}`,
        { retriable: true, cause },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** 发起请求并按 schema 校验;失败一律抛 ProviderError(结构化,不阻断整单流程) */
  async request<T>(schema: z.ZodType<T>, path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(path, this.opts.baseUrl);
    const safeEndpoint = redactUrl(url);

    if (!this.breaker.allowRequest()) {
      throw new ProviderError(
        this.provider,
        "circuit_open",
        `${this.provider} Provider 熔断中(短路返回,不阻断整单流程)`,
        { retriable: true },
      );
    }

    let lastError: ProviderError | null = null;
    let authRetried = false;

    for (let attemptNo = 0; attemptNo <= this.retries; attemptNo++) {
      if (attemptNo > 0) await this.sleep(this.retryBaseMs * 2 ** (attemptNo - 1));
      try {
        const res = await this.attempt(url, init, safeEndpoint);

        if (res.status === 401 && this.opts.onUnauthorized && !authRetried) {
          authRetried = true;
          await this.opts.onUnauthorized();
          lastError = new ProviderError(
            this.provider,
            "auth",
            `${this.provider} HTTP 401(已刷新凭据后重试): ${safeEndpoint}`,
            { status: 401, retriable: true },
          );
          attemptNo -= 1; // 凭据刷新不占用业务重试额度
          continue;
        }

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after"));
          lastError = new ProviderError(
            this.provider,
            res.status === 429 ? "rate_limited" : "http",
            `${this.provider} HTTP ${res.status}: ${safeEndpoint}`,
            {
              status: res.status,
              retriable: true,
              retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
            },
          );
          continue;
        }

        if (!res.ok) {
          this.breaker.onFailure();
          throw new ProviderError(
            this.provider,
            res.status === 401 || res.status === 403 ? "auth" : "http",
            `${this.provider} HTTP ${res.status}: ${safeEndpoint}`,
            { status: res.status, retriable: false },
          );
        }

        const json = await res.json().catch((cause) => {
          throw new ProviderError(
            this.provider,
            "validation",
            `${this.provider} 响应非 JSON: ${safeEndpoint}`,
            { cause },
          );
        });
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          this.breaker.onFailure();
          throw new ProviderError(
            this.provider,
            "validation",
            `${this.provider} 响应结构不符合契约: ${safeEndpoint}`,
            { cause: parsed.error },
          );
        }
        this.breaker.onSuccess();
        return parsed.data;
      } catch (e) {
        if (e instanceof ProviderError && e.retriable) {
          lastError = e;
          continue;
        }
        throw e;
      }
    }

    this.breaker.onFailure();
    throw (
      lastError ??
      new ProviderError(this.provider, "network", `${this.provider} 请求失败: ${safeEndpoint}`)
    );
  }
}
