/**
 * EzplmPartsProvider 接口(SPEC §7 签名)。
 * 业务代码只依赖本接口;Mock/Http 实现可互换(合同测试保证同构)。
 * 结构化错误统一使用 lib/providers/common/errors.ts 的 ProviderError。
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

export { ProviderError } from "../common/errors";
export type { ProviderErrorKind } from "../common/errors";

export interface EzplmPartsProvider {
  searchParts(input: SearchPartsInput): Promise<CanonicalPart[]>;
  getPartByMpn(input: GetPartByMpnInput): Promise<CanonicalPart | null>;
  batchResolve(inputs: BatchResolveInput[]): Promise<BatchResolveResult[]>;
  getInventory(partIds: string[]): Promise<InventoryResult[]>;
  getCustomerMappings(customerId: string): Promise<CustomerPartMappingDto[]>;
  getAlternates(partId: string): Promise<AlternatePart[]>;
  getCompliance(partId: string): Promise<ComplianceResult>;
}
