/**
 * ezPLM API Key 查询接口的**真实**响应契约。
 * 依据《API 密钥查询接口用户操作手册》与 2026-07-28 实际联调抓取的响应结构。
 *
 * ⚠ 只有两个只读接口:
 *   GET /api/v1/api-key/parts             — 系统库物料(白名单供应商)
 *   GET /api/v1/api-key/reference-designs — 参考设计(需 partlibId)
 * 库存、客户料号映射、替代料、合规状态**该 API 不提供** —— 相关方法必须如实报错,
 * 不得返回空数组冒充"查到了但没有"。
 *
 * 字段宽松原则:上游新增字段不应导致校验失败,故对象一律 passthrough;
 * 但**关键字段(id/mpn)缺失必须报错**,因为它们是后续一切操作的主键。
 */
import { z } from "zod";

/** 文件对象:库文件与数据手册共用同一形态 */
export const EzplmFileSchema = z
  .object({
    id: z.string().optional(),
    url: z.string(),
    fname: z.string().optional(),
  })
  .passthrough();
export type EzplmFile = z.infer<typeof EzplmFileSchema>;

export const EzplmNamedRefSchema = z
  .object({ id: z.string().optional(), name: z.string() })
  .passthrough();

/** 封装:含 KiCad 封装库文件与 STEP 三维模型 */
export const EzplmFootprintSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    kicadModFile: EzplmFileSchema.nullable().optional(),
    stepFile: EzplmFileSchema.nullable().optional(),
  })
  .passthrough();

/** 原理图符号:含 KiCad 符号库文件 */
export const EzplmSymbolSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    kicadSymFile: EzplmFileSchema.nullable().optional(),
  })
  .passthrough();

export const EzplmAttributeSchema = z
  .object({ name: z.string(), value: z.union([z.string(), z.number()]).nullable() })
  .passthrough();

export const EzplmPartSchema = z
  .object({
    id: z.string().min(1),
    mpn: z.string().min(1),
    description: z.string().nullable().optional(),
    officialUrl: z.string().nullable().optional(),
    manufacturer: EzplmNamedRefSchema.nullable().optional(),
    category: EzplmNamedRefSchema.nullable().optional(),
    footprint: EzplmFootprintSchema.nullable().optional(),
    symbol: EzplmSymbolSchema.nullable().optional(),
    pdf: EzplmFileSchema.nullable().optional(),
    attributes: z.array(EzplmAttributeSchema).nullable().optional(),
  })
  .passthrough();
export type EzplmApiPart = z.infer<typeof EzplmPartSchema>;

export const EzplmMetaSchema = z
  .object({
    timestamp: z.string().optional(),
    nextCursor: z.string().nullable().optional(),
    hasMore: z.boolean().optional(),
  })
  .passthrough();

export const EzplmPartsResponseSchema = z.object({
  data: z.array(EzplmPartSchema),
  meta: EzplmMetaSchema.optional(),
});

export const EzplmReferenceDesignSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    link: z.string().nullable().optional(),
    image: z.union([z.string(), z.object({}).passthrough()]).nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .passthrough();
export type EzplmReferenceDesign = z.infer<typeof EzplmReferenceDesignSchema>;

export const EzplmReferenceDesignsResponseSchema = z.object({
  data: z.array(EzplmReferenceDesignSchema),
  meta: EzplmMetaSchema.optional(),
});

/** 接口路径(手册固定,不再是草案) */
export const EZPLM_PATHS = {
  parts: "/api/v1/api-key/parts",
  referenceDesigns: "/api/v1/api-key/reference-designs",
} as const;
