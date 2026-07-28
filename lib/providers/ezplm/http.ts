/**
 * HttpEzplmProvider(SPEC §7):Zod 响应校验 + 超时 + 重试 + 熔断(共用 ProviderHttpClient)。
 *
 * ⚠ 状态:待联调。SPEC 明确"不要猜测真实 API URL"——
 * 下方 DEFAULT_PATHS 是接口需求草案(整合方案 7.3 第 1 项的需求文档形态),
 * 联调时以 ezPLM 正式文档为准,可经构造参数 paths 覆盖,无需改业务代码。
 * API Key 仅存服务端环境变量(EZPLM_API_BASE_URL / EZPLM_API_KEY)。
 */
import { z } from "zod";
import type { ApiUsageRecorder } from "../common/api-usage";
import { ProviderHttpClient } from "../common/http-client";
import type { EzplmPartsProvider } from "./provider";
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
  retries?: number;
  retryBaseMs?: number;
  breaker?: { failureThreshold?: number; cooldownMs?: number; now?: () => number };
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  usageRecorder?: ApiUsageRecorder;
}

export class HttpEzplmProvider implements EzplmPartsProvider {
  private readonly paths: EzplmEndpointPaths;
  private readonly http: ProviderHttpClient;

  constructor(opts: HttpEzplmProviderOptions) {
    if (!opts.baseUrl) throw new Error("EZPLM_API_BASE_URL 缺失");
    if (!opts.apiKey) throw new Error("EZPLM_API_KEY 缺失");
    this.paths = { ...DEFAULT_PATHS, ...opts.paths };
    this.http = new ProviderHttpClient({
      provider: "EZPLM",
      baseUrl: opts.baseUrl,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      retryBaseMs: opts.retryBaseMs,
      breaker: opts.breaker,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      usageRecorder: opts.usageRecorder,
      prepare: (init) => ({
        ...init,
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      }),
    });
  }

  async searchParts(input: SearchPartsInput): Promise<CanonicalPart[]> {
    const { keyword, limit } = SearchPartsInputSchema.parse(input);
    const q = new URLSearchParams({ q: keyword, limit: String(limit) });
    return this.http.request(z.array(CanonicalPartSchema), `${this.paths.searchParts}?${q}`, {
      method: "GET",
    });
  }

  async getPartByMpn(input: GetPartByMpnInput): Promise<CanonicalPart | null> {
    const q = new URLSearchParams({ mpn: input.mpn });
    if (input.manufacturer) q.set("manufacturer", input.manufacturer);
    return this.http.request(CanonicalPartSchema.nullable(), `${this.paths.getPartByMpn}?${q}`, {
      method: "GET",
    });
  }

  async batchResolve(inputs: BatchResolveInput[]): Promise<BatchResolveResult[]> {
    return this.http.request(z.array(BatchResolveResultSchema), this.paths.batchResolve, {
      method: "POST",
      body: JSON.stringify({ inputs }),
    });
  }

  async getInventory(partIds: string[]): Promise<InventoryResult[]> {
    return this.http.request(z.array(InventoryResultSchema), this.paths.inventory, {
      method: "POST",
      body: JSON.stringify({ partIds }),
    });
  }

  async getCustomerMappings(customerId: string): Promise<CustomerPartMappingDto[]> {
    return this.http.request(
      z.array(CustomerPartMappingDtoSchema),
      this.paths.customerMappings(customerId),
      { method: "GET" },
    );
  }

  async getAlternates(partId: string): Promise<AlternatePart[]> {
    return this.http.request(z.array(AlternatePartSchema), this.paths.alternates(partId), {
      method: "GET",
    });
  }

  async getCompliance(partId: string): Promise<ComplianceResult> {
    return this.http.request(ComplianceResultSchema, this.paths.compliance(partId), {
      method: "GET",
    });
  }
}
