/**
 * HttpEzplmProvider(SPEC §7):Zod 响应校验 + 超时 + 重试 + 熔断。
 *
 * ⚠ 状态:待联调。SPEC 明确"不要猜测真实 API URL"——
 * 下方 DEFAULT_PATHS 是接口需求草案(整合方案 7.3 第 1 项的需求文档形态),
 * 联调时以 ezPLM 正式文档为准,可经构造参数 paths 覆盖,无需改业务代码。
 * API Key 仅存服务端环境变量(EZPLM_API_BASE_URL / EZPLM_API_KEY)。
 */
import { z } from "zod";
import { CircuitBreaker } from "./circuit-breaker";
import { ProviderError, type EzplmPartsProvider } from "./provider";
import {
  AlternatePartSchema,
  BatchResolveResultSchema,
  CanonicalPartSchema,
  ComplianceResultSchema,
  CustomerPartMappingDtoSchema,
  InventoryResultSchema,
  SearchPartsInputSchema,
  type AlternatePart,
  type BatchResolveInput,
  type BatchResolveResult,
  type CanonicalPart,
  type ComplianceResult,
  type CustomerPartMappingDto,
  type GetPartByMpnInput,
  type InventoryResult,
  type SearchPartsInput,
} from "./types";

export interface EzplmEndpointPaths {
  searchParts: string;
  getPartByMpn: string;
  batchResolve: string;
  inventory: string;
  customerMappings: (customerId: string) => string;
  alternates: (partId: string) => string;
  compliance: (partId: string) => string;
}

/** 接口需求草案(待联调,以 ezPLM 正式文档为准) */
export const DEFAULT_PATHS: EzplmEndpointPaths = {
  searchParts: "/api/parts/search",
  getPartByMpn: "/api/parts/by-mpn",
  batchResolve: "/api/parts/batch-resolve",
  inventory: "/api/inventory/query",
  customerMappings: (customerId) => `/api/customers/${encodeURIComponent(customerId)}/part-mappings`,
  alternates: (partId) => `/api/parts/${encodeURIComponent(partId)}/alternates`,
  compliance: (partId) => `/api/parts/${encodeURIComponent(partId)}/compliance`,
};

export interface HttpEzplmProviderOptions {
  baseUrl: string;
  apiKey: string;
  paths?: Partial<EzplmEndpointPaths>;
  timeoutMs?: number;
  /** 429/5xx/网络错误的最大重试次数 */
  retries?: number;
  /** 重试退避基数(测试注入 1ms 免等待);第 n 次重试等待 base*2^n */
  retryBaseMs?: number;
  breaker?: { failureThreshold?: number; cooldownMs?: number; now?: () => number };
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpEzplmProvider implements EzplmPartsProvider {
  private readonly paths: EzplmEndpointPaths;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseMs: number;
  private readonly breaker: CircuitBreaker;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpEzplmProviderOptions) {
    if (!opts.baseUrl) throw new Error("EZPLM_API_BASE_URL 缺失");
    if (!opts.apiKey) throw new Error("EZPLM_API_KEY 缺失");
    this.paths = { ...DEFAULT_PATHS, ...opts.paths };
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
  }

  /** 单次 HTTP 尝试(超时经 AbortController) */
  private async attempt(path: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(new URL(path, this.opts.baseUrl), {
        ...init,
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: ctrl.signal,
      });
    } catch (cause) {
      if (ctrl.signal.aborted) {
        throw new ProviderError("timeout", `ezPLM 请求超时(${this.timeoutMs}ms): ${path}`, {
          retriable: true,
          cause,
        });
      }
      throw new ProviderError("network", `ezPLM 网络错误: ${path}`, { retriable: true, cause });
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(schema: z.ZodType<T>, path: string, init: RequestInit): Promise<T> {
    if (!this.breaker.allowRequest()) {
      throw new ProviderError("circuit_open", "ezPLM Provider 熔断中(短路返回,不阻断整单流程)", {
        retriable: true,
      });
    }
    let lastError: ProviderError | null = null;
    for (let attemptNo = 0; attemptNo <= this.retries; attemptNo++) {
      if (attemptNo > 0) await this.sleep(this.retryBaseMs * 2 ** (attemptNo - 1));
      try {
        const res = await this.attempt(path, init);
        if (res.status === 429 || res.status >= 500) {
          lastError = new ProviderError("http", `ezPLM HTTP ${res.status}: ${path}`, {
            status: res.status,
            retriable: true,
          });
          continue; // 退避重试
        }
        if (!res.ok) {
          this.breaker.onFailure();
          throw new ProviderError("http", `ezPLM HTTP ${res.status}: ${path}`, {
            status: res.status,
            retriable: false,
          });
        }
        const json = await res.json().catch((cause) => {
          throw new ProviderError("validation", `ezPLM 响应非 JSON: ${path}`, { cause });
        });
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          this.breaker.onFailure();
          throw new ProviderError("validation", `ezPLM 响应结构不符合契约: ${path}`, {
            cause: parsed.error,
          });
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
    throw lastError ?? new ProviderError("network", `ezPLM 请求失败: ${path}`);
  }

  async searchParts(input: SearchPartsInput): Promise<CanonicalPart[]> {
    const { keyword, limit } = SearchPartsInputSchema.parse(input);
    const q = new URLSearchParams({ q: keyword, limit: String(limit) });
    return this.request(z.array(CanonicalPartSchema), `${this.paths.searchParts}?${q}`, {
      method: "GET",
    });
  }

  async getPartByMpn(input: GetPartByMpnInput): Promise<CanonicalPart | null> {
    const q = new URLSearchParams({ mpn: input.mpn });
    if (input.manufacturer) q.set("manufacturer", input.manufacturer);
    return this.request(
      CanonicalPartSchema.nullable(),
      `${this.paths.getPartByMpn}?${q}`,
      { method: "GET" },
    );
  }

  async batchResolve(inputs: BatchResolveInput[]): Promise<BatchResolveResult[]> {
    return this.request(z.array(BatchResolveResultSchema), this.paths.batchResolve, {
      method: "POST",
      body: JSON.stringify({ inputs }),
    });
  }

  async getInventory(partIds: string[]): Promise<InventoryResult[]> {
    return this.request(z.array(InventoryResultSchema), this.paths.inventory, {
      method: "POST",
      body: JSON.stringify({ partIds }),
    });
  }

  async getCustomerMappings(customerId: string): Promise<CustomerPartMappingDto[]> {
    return this.request(
      z.array(CustomerPartMappingDtoSchema),
      this.paths.customerMappings(customerId),
      { method: "GET" },
    );
  }

  async getAlternates(partId: string): Promise<AlternatePart[]> {
    return this.request(z.array(AlternatePartSchema), this.paths.alternates(partId), {
      method: "GET",
    });
  }

  async getCompliance(partId: string): Promise<ComplianceResult> {
    return this.request(ComplianceResultSchema, this.paths.compliance(partId), { method: "GET" });
  }
}
