/**
 * EzplmPartsProvider 接口(SPEC §7 签名)与结构化错误。
 * 业务代码只依赖本接口;Mock/Http 实现可互换(合同测试保证同构)。
 */
import type {
  AlternatePart,
  BatchResolveInput,
  BatchResolveResult,
  CanonicalPart,
  ComplianceResult,
  CustomerPartMappingDto,
  GetPartByMpnInput,
  InventoryResult,
  SearchPartsInput,
} from "./types";

export interface EzplmPartsProvider {
  searchParts(input: SearchPartsInput): Promise<CanonicalPart[]>;
  getPartByMpn(input: GetPartByMpnInput): Promise<CanonicalPart | null>;
  batchResolve(inputs: BatchResolveInput[]): Promise<BatchResolveResult[]>;
  getInventory(partIds: string[]): Promise<InventoryResult[]>;
  getCustomerMappings(customerId: string): Promise<CustomerPartMappingDto[]>;
  getAlternates(partId: string): Promise<AlternatePart[]>;
  getCompliance(partId: string): Promise<ComplianceResult>;
}

export type ProviderErrorKind =
  | "timeout"
  | "http"
  | "network"
  | "validation"
  | "circuit_open"
  | "not_found";

/** 结构化错误:provider 不可用时返回,不阻断整个 BOM 流程(上层按行降级) */
export class ProviderError extends Error {
  readonly provider = "EZPLM";
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly options: { status?: number; retriable?: boolean; cause?: unknown } = {},
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
}
