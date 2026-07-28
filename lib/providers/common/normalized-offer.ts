/**
 * 统一供应报价模型(SPEC §10)。
 * ezPLM / DigiKey / Mouser / 线下供应商 Excel 的报价全部归一为 NormalizedOffer,
 * 下游的比价、排名、报价单只认本模型。
 *
 * 金额纪律:所有价格以「十进制字符串」承载(如 "0.0123"),
 * 禁止在 DTO 层使用 JS number 表示金额 —— 计算一律经 lib/domain/offers.ts 的 Decimal 函数。
 * 数量(stock/moq/spq)为整数件数,用 number 承载即可(超出安全整数范围的元器件数量不存在)。
 */
import { z } from "zod";

export const ProviderTypeSchema = z.enum(["EZPLM", "DIGIKEY", "MOUSER", "OFFLINE"]);
export type ProviderTypeValue = z.infer<typeof ProviderTypeSchema>;

export const LifecycleSchema = z.enum(["ACTIVE", "NRND", "EOL", "OBSOLETE", "UNKNOWN"]);
export type LifecycleValue = z.infer<typeof LifecycleSchema>;

/** 十进制金额字符串:允许 "12"、"0.0123";禁止 NaN/科学计数法 */
export const DecimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "金额必须为十进制字符串(禁止浮点/科学计数法)");

export const PriceBreakSchema = z.object({
  /** 该阶梯的起订数量(含) */
  minQty: z.number().int().nonnegative(),
  unitPrice: DecimalStringSchema,
});
export type NormalizedPriceBreak = z.infer<typeof PriceBreakSchema>;

export const NormalizedOfferSchema = z.object({
  provider: ProviderTypeSchema,
  providerPartNumber: z.string().nullable(),
  manufacturer: z.string().nullable(),
  mpn: z.string(),
  description: z.string().nullable(),
  packaging: z.string().nullable(),
  stock: z.number().nonnegative().nullable(),
  moq: z.number().nonnegative().nullable(),
  spq: z.number().nonnegative().nullable(),
  leadTimeDays: z.number().int().nonnegative().nullable(),
  lifecycle: LifecycleSchema,
  rohs: z.boolean().nullable(),
  reach: z.boolean().nullable(),
  /** ISO 4217,如 CNY / USD */
  currency: z.string().min(3).max(3),
  priceBreaks: z.array(PriceBreakSchema),
  /** 供应商侧数据时间;诚实 UI 依此显示「数据更新时间」,不得暗示实时 */
  sourceUpdatedAt: z.string().datetime().nullable(),
  sourceUrl: z.string().nullable(),

  // —— 以下为本系统扩展字段(SPEC §10 字段表之外)——
  // 理由:SPEC §10 要求排名考虑「供应商优先级」,但字段表未给出承载处;
  // 线下供应商报价还需回链本系统 Supplier 主体,故以可选字段承载,不影响三方 API 归一。
  supplierId: z.string().nullable().optional(),
  /** 数值越小优先级越高(与 Prisma Supplier.priority 一致,缺省 100) */
  supplierPriority: z.number().int().positive().nullable().optional(),
});
export type NormalizedOffer = z.infer<typeof NormalizedOfferSchema>;
