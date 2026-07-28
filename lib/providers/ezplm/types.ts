/**
 * ezPLM Parts Provider 数据契约(SPEC §7)。
 * 全部响应经 Zod 校验;类型从 schema 推导,业务代码不感知 Mock/Http 差异。
 */
import { z } from "zod";

export const LifecycleSchema = z.enum(["ACTIVE", "NRND", "EOL", "OBSOLETE", "UNKNOWN"]);

export const CanonicalPartSchema = z.object({
  /** ezPLM 侧物料 ID(真源主键) */
  id: z.string().min(1),
  internalPn: z.string().min(1),
  mpn: z.string().nullable(),
  manufacturer: z.string().nullable(),
  description: z.string().nullable(),
  footprint: z.string().nullable(),
  lifecycle: LifecycleSchema,
  rohs: z.boolean().nullable(),
  reach: z.boolean().nullable(),
  msl: z.string().nullable(),
  packaging: z.string().nullable(),
  dateCode: z.string().nullable(),
  /** 数据更新时间(诚实 UI:候选必须展示) */
  updatedAt: z.string().datetime(),
});
export type CanonicalPart = z.infer<typeof CanonicalPartSchema>;

export const SearchPartsInputSchema = z.object({
  keyword: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchPartsInput = z.input<typeof SearchPartsInputSchema>;

export const GetPartByMpnInputSchema = z.object({
  mpn: z.string().min(1),
  manufacturer: z.string().optional(),
});
export type GetPartByMpnInput = z.input<typeof GetPartByMpnInputSchema>;

export const BatchResolveInputSchema = z.object({
  customerPn: z.string().optional(),
  internalPn: z.string().optional(),
  mpn: z.string().optional(),
  manufacturer: z.string().optional(),
});
export type BatchResolveInput = z.input<typeof BatchResolveInputSchema>;

export const BatchResolveResultSchema = z.object({
  query: BatchResolveInputSchema,
  part: CanonicalPartSchema.nullable(),
  /** 置信度 0–1(仅供排序展示;正式匹配必须人工确认) */
  confidence: z.number().min(0).max(1),
});
export type BatchResolveResult = z.infer<typeof BatchResolveResultSchema>;

export const InventoryResultSchema = z.object({
  partId: z.string(),
  qtyOnHand: z.number(),
  qtySlowMoving: z.number().nullable(),
  warehouse: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type InventoryResult = z.infer<typeof InventoryResultSchema>;

export const CustomerPartMappingDtoSchema = z.object({
  customerId: z.string(),
  customerPn: z.string(),
  internalPn: z.string().nullable(),
  mpn: z.string().nullable(),
  manufacturer: z.string().nullable(),
});
export type CustomerPartMappingDto = z.infer<typeof CustomerPartMappingDtoSchema>;

export const AlternatePartSchema = z.object({
  partId: z.string(),
  alternate: CanonicalPartSchema,
  /** 替代等级,如 完全替代/条件替代 */
  grade: z.string().nullable(),
  note: z.string().nullable(),
});
export type AlternatePart = z.infer<typeof AlternatePartSchema>;

export const ComplianceResultSchema = z.object({
  partId: z.string(),
  rohs: z.boolean().nullable(),
  reach: z.boolean().nullable(),
  notes: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type ComplianceResult = z.infer<typeof ComplianceResultSchema>;
