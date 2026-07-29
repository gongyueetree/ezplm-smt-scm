/**
 * ezPLM Parts Provider 数据契约(SPEC §7)。
 * 全部响应经 Zod 校验;类型从 schema 推导,业务代码不感知 Mock/Http 差异。
 */
import { z } from "zod";

export const LifecycleSchema = z.enum(["ACTIVE", "NRND", "EOL", "OBSOLETE", "UNKNOWN"]);

export const CanonicalPartSchema = z.object({
  /** ezPLM 侧物料 ID(真源主键) */
  id: z.string().min(1),
  /** ezPLM API Key 接口不返回内部料号,故可空 */
  internalPn: z.string().min(1).nullable(),
  mpn: z.string().nullable(),
  manufacturer: z.string().nullable(),
  description: z.string().nullable(),
  footprint: z.string().nullable(),
  /** 器件分类(ezPLM 提供;用于 UI 徽标与后续按品类定参数硬约束) */
  category: z.string().nullable().default(null),
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

// ============================================================
// 物料详情扩展(SPEC §7 接口清单之外的增量)
// 依据:客户要求物料详情需含 库文件 / 数据手册 / 基本参数 / 替代料,
// 对应静态原型 material-detail.html 的「规格参数 / 文档 / 替代料关系」页签。
// ezPLM 为工程文件的唯一真源,本系统只读。
// ============================================================

export const PartDocumentKindSchema = z.enum([
  "DATASHEET",
  "SYMBOL",
  "FOOTPRINT",
  "MODEL_3D",
  "APP_NOTE",
  "CERTIFICATE",
  "OTHER",
]);
export type PartDocumentKind = z.infer<typeof PartDocumentKindSchema>;

export const PartDocumentSchema = z.object({
  id: z.string(),
  kind: PartDocumentKindSchema,
  name: z.string(),
  /** 下载/查看地址;ezPLM 侧地址,本系统不复制文件 */
  url: z.string().nullable(),
  version: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type PartDocument = z.infer<typeof PartDocumentSchema>;

export const PartParameterSchema = z.object({
  name: z.string(),
  value: z.string(),
  unit: z.string().nullable(),
  /** 分组(如 电气特性 / 封装 / 温度),便于分区展示 */
  group: z.string().nullable(),
});
export type PartParameter = z.infer<typeof PartParameterSchema>;

export const PartDetailSchema = z.object({
  part: CanonicalPartSchema,
  parameters: z.array(PartParameterSchema),
  documents: z.array(PartDocumentSchema),
});
export type PartDetail = z.infer<typeof PartDetailSchema>;
