/**
 * DigiKey OAuth2(SPEC §8):client_credentials 取 token,服务端缓存 + 自动刷新。
 *
 * ⚠ 安全:CLIENT_ID/SECRET 与 access_token 仅存在于服务端进程内,
 * 绝不写入日志、错误消息或响应体;TokenStore 只暴露过期时间等非敏感状态。
 */
import { z } from "zod";
import { ProviderError } from "../common/errors";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
});

export interface CachedToken {
  accessToken: string;
  /** 绝对过期时间(ms) */
  expiresAt: number;
}

/** 服务端 token 缓存(进程内);多实例部署各自持有,DigiKey 允许并发 token */
export class DigiKeyTokenStore {
  private token: CachedToken | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get(): CachedToken | null {
    if (!this.token) return null;
    return this.token.expiresAt > this.now() ? this.token : null;
  }

  set(accessToken: string, expiresInSeconds: number, safetyWindowSeconds = 60): void {
    // 提前 safetyWindow 视为过期,避免边界期请求带着即将失效的 token
    this.token = {
      accessToken,
      expiresAt: this.now() + Math.max(0, expiresInSeconds - safetyWindowSeconds) * 1000,
    };
  }

  clear(): void {
    this.token = null;
  }

  /** 非敏感状态(可用于健康检查/诊断页,永不含 token 本身) */
  status(): { cached: boolean; expiresInMs: number | null } {
    if (!this.token) return { cached: false, expiresInMs: null };
    return { cached: true, expiresInMs: Math.max(0, this.token.expiresAt - this.now()) };
  }
}

export interface DigiKeyAuthOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  store?: DigiKeyTokenStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export class DigiKeyAuthService {
  private readonly store: DigiKeyTokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  /** 单飞:并发请求共享同一次刷新,避免 token 端点被打爆 */
  private inflight: Promise<string> | null = null;

  constructor(private readonly opts: DigiKeyAuthOptions) {
    if (!opts.clientId || !opts.clientSecret) {
      throw new Error("DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET 缺失(仅服务端环境变量)");
    }
    this.store = opts.store ?? new DigiKeyTokenStore(opts.now);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  get tokenStore(): DigiKeyTokenStore {
    return this.store;
  }

  async getAccessToken(): Promise<string> {
    const cached = this.store.get();
    if (cached) return cached.accessToken;
    if (this.inflight) return this.inflight;

    this.inflight = this.fetchToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    const url = new URL("/v1/oauth2/token", this.opts.baseUrl);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.opts.clientId,
          client_secret: this.opts.clientSecret,
          grant_type: "client_credentials",
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // 不回显请求体(含 secret),只给状态码
        throw new ProviderError("DIGIKEY", "auth", `DigiKey OAuth 失败 HTTP ${res.status}`, {
          status: res.status,
          retriable: res.status >= 500,
        });
      }
      const parsed = TokenResponseSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) {
        throw new ProviderError("DIGIKEY", "validation", "DigiKey OAuth 响应结构不符合契约");
      }
      this.store.set(parsed.data.access_token, parsed.data.expires_in);
      return parsed.data.access_token;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (ctrl.signal.aborted) {
        throw new ProviderError("DIGIKEY", "timeout", `DigiKey OAuth 超时(${this.timeoutMs}ms)`, {
          retriable: true,
        });
      }
      throw new ProviderError("DIGIKEY", "network", "DigiKey OAuth 网络错误", { retriable: true });
    } finally {
      clearTimeout(timer);
    }
  }
}
