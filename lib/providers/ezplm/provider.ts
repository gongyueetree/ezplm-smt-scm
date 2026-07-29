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
  PartDocument,
  PartParameter,
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
  /** 规格参数(SPEC §7 之外的增量;物料详情页「规格参数」页签) */
  getParameters(partId: string): Promise<PartParameter[]>;
  /**
   * 一次检索同时拿回**候选与其参数**。
   *
   * 为什么单独给一个方法:替代料分析要对每个候选逐项比参数,
   * 若先 searchParts 再逐个 getParameters,一次分析就是 N+1 次调用 ——
   * ezPLM 有日配额,几次分析就能把配额打光。
   */
  searchPartsWithParameters(
    input: SearchPartsInput,
  ): Promise<{ part: CanonicalPart; parameters: PartParameter[] }[]>;
  /** 库文件 / 数据手册等工程文档(ezPLM 为唯一真源,本系统只读不复制) */
  getDocuments(partId: string): Promise<PartDocument[]>;
}
