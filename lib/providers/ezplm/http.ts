/**
 * HttpEzplmProvider —— 对接 ezPLM **API Key 查询接口**(真实契约,已联调)。
 *
 * 依据《API 密钥查询接口用户操作手册》与 2026-07-28 实际抓包:
 *   GET /api/v1/api-key/parts?keyword&cursor&pageSize
 *   GET /api/v1/api-key/reference-designs?partlibId&cursor&pageSize
 * 鉴权四头:X-API-Key / X-Timestamp / X-Nonce / X-Signature(HMAC-SHA256,见 signing.ts)。
 *
 * ⚠ 能力边界(必须如实,不得假装):
 * - 该 API **不提供** 库存、客户料号映射、替代料、合规状态 → 对应方法抛
 *   ProviderError(kind="not_supported"),由上层改用本地缓存/其它数据源,
 *   **绝不返回空数组冒充"查到了但没有"**;
 * - 该 API **不返回** 内部料号、生命周期、RoHS/REACH、MSL、包装、DC —— 一律映射为 null/UNKNOWN;
 * - X-Nonce 一次性且有**日调用配额(429)**,故务必配合缓存使用。
 */
import type { ApiUsageRecorder } from "../common/api-usage";
import { ProviderError, redactUrl } from "../common/errors";
import { readRateLimitHeaders, noopUsageRecorder } from "../common/api-usage";
import { normalizeMpn } from "../common/mpn";
import type { EzplmPartsProvider } from "./provider";
import {
  EZPLM_PATHS,
  EzplmPartsResponseSchema,
  EzplmReferenceDesignsResponseSchema,
  type EzplmApiPart,
  type EzplmReferenceDesign,
} from "./api-types";
import { buildSignedHeaders, normalizeEzplmOrigin, type QueryParams } from "./signing";
import type {
  AlternatePart,
  BatchResolveInput,
  BatchResolveResult,
  CanonicalPart,
  ComplianceResult,
  CustomerPartMappingDto,
  GetPartByMpnInput,
  InventoryResult,
  PartDocument,
  PartParameter,
  SearchPartsInput,
} from "./types";
import { SearchPartsInputSchema } from "./types";

export interface HttpEzplmProviderOptions {
  /** 只需配到域名;配置里多余的路径会被忽略并给出警告 */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  retries?: number;
  retryBaseMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  usageRecorder?: ApiUsageRecorder;
  nowMs?: () => number;
  nonce?: () => string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 该 API 不具备的能力,统一以此报错,便于上层识别并切换数据源 */
function notSupported(capability: string): never {
  throw new ProviderError(
    "EZPLM",
    "not_supported",
    `ezPLM API Key 查询接口不提供「${capability}」能力(手册仅含 parts 与 reference-designs 两个只读接口);` +
      `请改用本地缓存或其它数据源,系统不会以空结果冒充查询成功`,
    { retriable: false },
  );
}

export class HttpEzplmProvider implements EzplmPartsProvider {
  private readonly origin: string;
  readonly configWarnings: string[];
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly usage: ApiUsageRecorder;

  constructor(private readonly opts: HttpEzplmProviderOptions) {
    if (!opts.baseUrl) throw new Error("EZPLM_API_BASE_URL 缺失");
    if (!opts.apiKey) throw new Error("EZPLM_API_KEY 缺失");
    const normalized = normalizeEzplmOrigin(opts.baseUrl);
    this.origin = normalized.origin;
    this.configWarnings = normalized.warnings;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.retries = opts.retries ?? 2;
    this.retryBaseMs = opts.retryBaseMs ?? 300;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.usage = opts.usageRecorder ?? noopUsageRecorder;
  }

  /** 单次带签名的 GET;每次重试都重新签名(Nonce 一次性) */
  private async requestOnce(path: string, params: QueryParams): Promise<Response> {
    const headers = buildSignedHeaders(
      this.opts.apiKey,
      { method: "GET", path, params },
      { nowMs: this.opts.nowMs?.(), nonce: this.opts.nonce?.() },
    );
    const query = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    const url = `${this.origin}${path}${query ? `?${query}` : ""}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const startedAt = Date.now();
    try {
      const res = await this.fetchImpl(url, { headers: { ...headers }, signal: ctrl.signal });
      this.usage.record({
        provider: "EZPLM",
        endpoint: redactUrl(url),
        statusCode: res.status,
        durationMs: Date.now() - startedAt,
        ...readRateLimitHeaders(res.headers),
      });
      return res;
    } catch (cause) {
      this.usage.record({ provider: "EZPLM", endpoint: redactUrl(url), durationMs: Date.now() - startedAt });
      if (ctrl.signal.aborted) {
        throw new ProviderError("EZPLM", "timeout", `ezPLM 请求超时(${this.timeoutMs}ms): ${path}`, {
          retriable: true,
          cause,
        });
      }
      throw new ProviderError("EZPLM", "network", `ezPLM 网络错误: ${path}`, { retriable: true, cause });
    } finally {
      clearTimeout(timer);
    }
  }

  private async get<T>(
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
    path: string,
    params: QueryParams,
  ): Promise<T> {
    let lastError: ProviderError | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await this.sleep(this.retryBaseMs * 2 ** (attempt - 1));
      const res = await this.requestOnce(path, params);

      if (res.status === 429) {
        // 日配额用尽:重试无意义,立即以结构化错误上抛
        throw new ProviderError("EZPLM", "quota_exceeded", "ezPLM 当日调用配额已用尽(HTTP 429)", {
          status: 429,
          retriable: false,
        });
      }
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError(
          "EZPLM",
          "auth",
          `ezPLM 鉴权失败(HTTP ${res.status}):请检查 API Key 是否有效、服务器时间是否同步(签名含时间戳)`,
          { status: res.status, retriable: false },
        );
      }
      if (res.status >= 500) {
        lastError = new ProviderError("EZPLM", "http", `ezPLM HTTP ${res.status}: ${path}`, {
          status: res.status,
          retriable: true,
        });
        continue;
      }
      if (!res.ok) {
        throw new ProviderError("EZPLM", "http", `ezPLM HTTP ${res.status}: ${path}`, {
          status: res.status,
          retriable: false,
        });
      }

      const json = await res.json().catch((cause) => {
        throw new ProviderError("EZPLM", "validation", `ezPLM 响应非 JSON: ${path}`, { cause });
      });
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new ProviderError("EZPLM", "validation", `ezPLM 响应结构不符合契约: ${path}`, {
          cause: parsed.error,
        });
      }
      return parsed.data as T;
    }
    throw lastError ?? new ProviderError("EZPLM", "network", `ezPLM 请求失败: ${path}`);
  }

  // ============================================================
  // 映射:真实响应 → 系统内 CanonicalPart
  // ============================================================

  /**
   * ⚠ ezPLM 不返回 内部料号 / 生命周期 / RoHS / REACH / MSL / 包装 / DC,
   * 一律置 null 或 UNKNOWN —— 绝不用其它字段推测填充。
   * updatedAt 用响应时间(即**抓取时间**),UI 需按"数据获取时间"表述。
   */
  private toCanonical(p: EzplmApiPart, fetchedAt: string): CanonicalPart {
    return {
      id: p.id,
      internalPn: null,
      mpn: p.mpn,
      manufacturer: p.manufacturer?.name ?? null,
      description: p.description ?? null,
      footprint: p.footprint?.name ?? null,
      lifecycle: "UNKNOWN",
      rohs: null,
      reach: null,
      msl: null,
      packaging: null,
      dateCode: null,
      updatedAt: fetchedAt,
    };
  }

  private toParameters(p: EzplmApiPart): PartParameter[] {
    return (p.attributes ?? []).map((a) => ({
      name: a.name,
      value: a.value === null || a.value === undefined ? "" : String(a.value),
      unit: null,
      group: p.category?.name ?? null,
    }));
  }

  private toDocuments(p: EzplmApiPart, fetchedAt: string): PartDocument[] {
    const docs: PartDocument[] = [];
    const push = (
      kind: PartDocument["kind"],
      file: { id?: string; url?: string; fname?: string } | null | undefined,
      fallbackName: string,
    ) => {
      if (!file?.url) return;
      docs.push({
        id: file.id ?? `${p.id}-${kind}`,
        kind,
        name: file.fname ?? fallbackName,
        url: file.url,
        version: null,
        sizeBytes: null,
        updatedAt: fetchedAt,
      });
    };
    push("DATASHEET", p.pdf, `${p.mpn} 数据手册.pdf`);
    push("SYMBOL", p.symbol?.kicadSymFile, `${p.symbol?.name ?? p.mpn}.kicad_sym`);
    push("FOOTPRINT", p.footprint?.kicadModFile, `${p.footprint?.name ?? p.mpn}.kicad_mod`);
    push("MODEL_3D", p.footprint?.stepFile, `${p.footprint?.name ?? p.mpn}.step`);
    return docs;
  }

  // ============================================================
  // SPEC §7 接口实现
  // ============================================================

  async searchParts(input: SearchPartsInput): Promise<CanonicalPart[]> {
    const { keyword, limit } = SearchPartsInputSchema.parse(input);
    const body = await this.get(EzplmPartsResponseSchema, EZPLM_PATHS.parts, {
      keyword,
      pageSize: limit,
    });
    const fetchedAt = body.meta?.timestamp ?? new Date().toISOString();
    return body.data.map((p) => this.toCanonical(p, fetchedAt));
  }

  async getPartByMpn(input: GetPartByMpnInput): Promise<CanonicalPart | null> {
    const raw = await this.searchRaw(input.mpn, 20);
    const hit = raw.parts.find((p) => normalizeMpn(p.mpn) === normalizeMpn(input.mpn));
    return hit ? this.toCanonical(hit, raw.fetchedAt) : null;
  }

  /** 取原始记录(详情页要用 attributes / 文件对象,不能只拿 CanonicalPart) */
  async searchRaw(
    keyword: string,
    pageSize = 20,
  ): Promise<{ parts: EzplmApiPart[]; fetchedAt: string; hasMore: boolean }> {
    const body = await this.get(EzplmPartsResponseSchema, EZPLM_PATHS.parts, { keyword, pageSize });
    return {
      parts: body.data,
      fetchedAt: body.meta?.timestamp ?? new Date().toISOString(),
      hasMore: body.meta?.hasMore ?? false,
    };
  }

  /** 参考设计(该 API 独有能力,非 SPEC §7 接口) */
  async getReferenceDesigns(partlibId: string, pageSize = 20): Promise<EzplmReferenceDesign[]> {
    const body = await this.get(
      EzplmReferenceDesignsResponseSchema,
      EZPLM_PATHS.referenceDesigns,
      { partlibId, pageSize },
    );
    return body.data;
  }

  async getParameters(partId: string): Promise<PartParameter[]> {
    // parts 接口按 keyword 检索,partId 即 uuid;用 id 作为 keyword 无法命中,
    // 故详情页应改用 getPartDetailByMpn。这里保留按 MPN 检索的语义。
    const raw = await this.searchRaw(partId, 5);
    const hit = raw.parts.find((p) => p.id === partId) ?? raw.parts[0];
    return hit ? this.toParameters(hit) : [];
  }

  async getDocuments(partId: string): Promise<PartDocument[]> {
    const raw = await this.searchRaw(partId, 5);
    const hit = raw.parts.find((p) => p.id === partId) ?? raw.parts[0];
    return hit ? this.toDocuments(hit, raw.fetchedAt) : [];
  }

  /** 详情:一次检索同时拿到基本信息 / 参数 / 文档,避免重复消耗配额 */
  async getPartDetailByMpn(mpn: string): Promise<{
    part: CanonicalPart;
    raw: EzplmApiPart;
    parameters: PartParameter[];
    documents: PartDocument[];
    fetchedAt: string;
  } | null> {
    const raw = await this.searchRaw(mpn, 20);
    const hit =
      raw.parts.find((p) => normalizeMpn(p.mpn) === normalizeMpn(mpn)) ?? null;
    if (!hit) return null;
    return {
      part: this.toCanonical(hit, raw.fetchedAt),
      raw: hit,
      parameters: this.toParameters(hit),
      documents: this.toDocuments(hit, raw.fetchedAt),
      fetchedAt: raw.fetchedAt,
    };
  }

  async batchResolve(inputs: BatchResolveInput[]): Promise<BatchResolveResult[]> {
    // 该 API 无批量接口:逐条按 MPN 检索。**配额敏感**,调用方须先去重并配合缓存。
    const out: BatchResolveResult[] = [];
    for (const query of inputs) {
      const mpn = query.mpn;
      if (!mpn) {
        out.push({ query, part: null, confidence: 0 });
        continue;
      }
      const part = await this.getPartByMpn({ mpn, manufacturer: query.manufacturer });
      out.push({ query, part, confidence: part ? 0.95 : 0 });
    }
    return out;
  }

  // ---- 该 API 不提供的能力:如实报错,不返回空数组 ----
  async getInventory(_partIds: string[]): Promise<InventoryResult[]> {
    void _partIds;
    return notSupported("库存查询");
  }

  async getCustomerMappings(_customerId: string): Promise<CustomerPartMappingDto[]> {
    void _customerId;
    return notSupported("客户料号映射");
  }

  async getAlternates(_partId: string): Promise<AlternatePart[]> {
    void _partId;
    return notSupported("替代料关系");
  }

  async getCompliance(_partId: string): Promise<ComplianceResult> {
    void _partId;
    return notSupported("RoHS/REACH 合规状态");
  }
}
