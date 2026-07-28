/**
 * Provider 结构化错误(SPEC §8:provider 不可用时返回 structured error,不阻断整个 BOM)。
 *
 * ⚠ 安全纪律:错误消息与 cause 序列化后禁止出现任何 API Key / token 明文,
 * 端点一律经 redactUrl() 脱敏后才可进入 message / 日志 / ApiUsageLog。
 */

export type ProviderName = "EZPLM" | "DIGIKEY" | "MOUSER" | "OFFLINE";

export type ProviderErrorKind =
  | "timeout"
  | "http"
  | "network"
  | "validation"
  | "circuit_open"
  | "rate_limited"
  | "quota_exceeded"
  | "auth"
  | "not_supported"
  | "not_found";

export interface ProviderErrorOptions {
  status?: number;
  retriable?: boolean;
  /** 建议重试等待毫秒(限流/配额场景) */
  retryAfterMs?: number;
  cause?: unknown;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly options: ProviderErrorOptions = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get retriable(): boolean {
    return this.options.retriable ?? false;
  }
  get status(): number | undefined {
    return this.options.status;
  }
  get retryAfterMs(): number | undefined {
    return this.options.retryAfterMs;
  }

  /** 供 UI/日志使用的安全摘要(不含 cause,避免 Key 经嵌套对象泄漏) */
  toSafeJSON(): Record<string, unknown> {
    return {
      provider: this.provider,
      kind: this.kind,
      message: this.message,
      status: this.status,
      retriable: this.retriable,
    };
  }
}

/** 敏感查询参数名(小写比较);Mouser 的 apiKey 走 query,必须脱敏后才能记录 */
const SECRET_QUERY_KEYS = ["apikey", "api_key", "key", "access_token", "token", "client_secret"];

/**
 * URL 脱敏:保留 origin+path,敏感 query 值替换为 ***。
 * 任何进入日志 / ApiUsageLog / 错误消息的端点都必须先经过本函数。
 */
export function redactUrl(input: string | URL): string {
  try {
    const url = new URL(String(input));
    for (const [k] of url.searchParams) {
      if (SECRET_QUERY_KEYS.includes(k.toLowerCase())) url.searchParams.set(k, "***");
    }
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    // 相对路径:仅做 query 层面的正则脱敏
    return String(input).replace(
      new RegExp(`([?&](?:${SECRET_QUERY_KEYS.join("|")})=)[^&#]*`, "gi"),
      "$1***",
    );
  }
}
