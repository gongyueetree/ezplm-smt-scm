/**
 * Mouser Search API v1 响应契约(SPEC §9)。
 * 与 DigiKey 同样采用宽松 passthrough:容忍字段新增,拦截类型不符。
 */
import { z } from "zod";

export const MouserPriceBreakSchema = z
  .object({
    Quantity: z.number(),
    /** 形如 "¥1.23" / "$1,234.56" */
    Price: z.union([z.string(), z.number()]),
    Currency: z.string().optional().nullable(),
  })
  .passthrough();

export const MouserPartSchema = z
  .object({
    MouserPartNumber: z.string().optional().nullable(),
    ManufacturerPartNumber: z.string(),
    Manufacturer: z.string().optional().nullable(),
    Description: z.string().optional().nullable(),
    /** 形如 "500 In Stock" */
    Availability: z.string().optional().nullable(),
    FactoryStock: z.string().optional().nullable(),
    /** 形如 "14 Days" */
    LeadTime: z.string().optional().nullable(),
    /** 最小起订量 */
    Min: z.union([z.string(), z.number()]).optional().nullable(),
    /** 订购倍数(SPQ) */
    Mult: z.union([z.string(), z.number()]).optional().nullable(),
    PriceBreaks: z.array(MouserPriceBreakSchema).optional().nullable(),
    ProductDetailUrl: z.string().optional().nullable(),
    LifecycleStatus: z.string().optional().nullable(),
    ProductStatus: z.string().optional().nullable(),
    ROHSStatus: z.string().optional().nullable(),
    ReachStatus: z.string().optional().nullable(),
    PackagingOptions: z.array(z.string()).optional().nullable(),
  })
  .passthrough();
export type MouserPart = z.infer<typeof MouserPartSchema>;

export const MouserSearchResponseSchema = z
  .object({
    Errors: z
      .array(
        z
          .object({
            Id: z.number().optional().nullable(),
            Code: z.string().optional().nullable(),
            Message: z.string().optional().nullable(),
          })
          .passthrough(),
      )
      .optional()
      .nullable(),
    SearchResults: z
      .object({
        NumberOfResult: z.number().optional().nullable(),
        Parts: z.array(MouserPartSchema).optional().nullable(),
      })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough();
export type MouserSearchResponse = z.infer<typeof MouserSearchResponseSchema>;
