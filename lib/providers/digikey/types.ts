/**
 * DigiKey Product Information V4 响应契约(SPEC §8)。
 *
 * 宽松策略:只对「本系统真正读取的字段」做校验,其余字段允许存在与新增
 * (passthrough)—— 三方新增字段不应导致整单比价失败;
 * 但字段类型不符仍会被 Zod 拦下,转为 validation 结构化错误。
 */
import { z } from "zod";

export const DkPricingSchema = z.object({
  BreakQuantity: z.number(),
  UnitPrice: z.number(),
});

export const DkVariationSchema = z
  .object({
    DigiKeyProductNumber: z.string().optional().nullable(),
    PackageType: z.object({ Name: z.string().optional().nullable() }).partial().optional().nullable(),
    StandardPricing: z.array(DkPricingSchema).optional().nullable(),
    MinimumOrderQuantity: z.number().optional().nullable(),
    StandardPackage: z.number().optional().nullable(),
    QuantityAvailableforPackageType: z.number().optional().nullable(),
  })
  .passthrough();

export const DkProductSchema = z
  .object({
    ManufacturerProductNumber: z.string(),
    Manufacturer: z
      .object({ Name: z.string().optional().nullable() })
      .partial()
      .optional()
      .nullable(),
    Description: z
      .object({
        ProductDescription: z.string().optional().nullable(),
        DetailedDescription: z.string().optional().nullable(),
      })
      .partial()
      .optional()
      .nullable(),
    QuantityAvailable: z.number().optional().nullable(),
    ProductUrl: z.string().optional().nullable(),
    ProductStatus: z.object({ Status: z.string().optional().nullable() }).partial().optional().nullable(),
    ProductVariations: z.array(DkVariationSchema).optional().nullable(),
    Classifications: z
      .object({
        RohsStatus: z.string().optional().nullable(),
        ReachStatus: z.string().optional().nullable(),
        MoistureSensitivityLevel: z.string().optional().nullable(),
      })
      .partial()
      .optional()
      .nullable(),
    ManufacturerLeadWeeks: z.string().optional().nullable(),
    UnitPrice: z.number().optional().nullable(),
  })
  .passthrough();
export type DkProduct = z.infer<typeof DkProductSchema>;

/** GET /products/v4/search/{productNumber}/productdetails */
export const DkProductDetailsResponseSchema = z
  .object({ Product: DkProductSchema.nullable().optional() })
  .passthrough();

/** GET /products/v4/search/{productNumber}/pricing */
export const DkProductPricingResponseSchema = z
  .object({
    Product: z
      .object({
        ManufacturerProductNumber: z.string().optional().nullable(),
        ProductVariations: z.array(DkVariationSchema).optional().nullable(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

/** POST /products/v4/search/keyword */
export const DkKeywordSearchResponseSchema = z
  .object({
    Products: z.array(DkProductSchema).optional().nullable(),
    ExactMatches: z.array(DkProductSchema).optional().nullable(),
    ProductsCount: z.number().optional().nullable(),
  })
  .passthrough();

/** GET /products/v4/search/{productNumber}/substitutions */
export const DkSubstitutionsResponseSchema = z
  .object({
    ProductSubstitutes: z.array(DkProductSchema).optional().nullable(),
    Count: z.number().optional().nullable(),
  })
  .passthrough();

/** GET /products/v4/search/{productNumber}/recommendedproducts */
export const DkRecommendedResponseSchema = z
  .object({
    RecommendedProducts: z.array(DkProductSchema).optional().nullable(),
    Products: z.array(DkProductSchema).optional().nullable(),
  })
  .passthrough();
