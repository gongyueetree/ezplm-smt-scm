/**
 * ERP Lab 合约**镜像**(源:`gongyueetree/ezplm-erp-lab` @ `src/lib/providers/erp/{contracts,types}.ts`)。
 *
 * 为什么镜像而不是共享包:两仓库署技术栈不同(Lab 是 Vite+Vercel Functions,
 * 本仓是 Next.js),发共享 npm 包的维护成本高于收益(Round2 审计结论)。
 * 代价是**可能漂移** —— 所以这里每个 Schema 都是逐字段照抄 Lab 的 interface,
 * 并由 `tests/unit/erp-lab-contract.test.ts` 锁死:字段名、操作名、场景码
 * 任何一侧改了,契约测试先红,而不是运行时静默丢字段。
 *
 * 命名约定:一律带 `Lab` 前缀,与本系统自己的 ERP DTO(`../types.ts`)区分 ——
 * 两套 DTO 的换算只发生在 `./index.ts` 的 Adapter 里,业务代码永远只见本系统 DTO。
 */
import { z } from "zod";

/** Lab 全部金额/数量都是 Decimal String —— 校验格式,防止上游混入浮点串 */
export const DecimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/, "必须是 Decimal String");

export const LabMaterialSchema = z.object({
  externalId: z.string(),
  materialCode: z.string(),
  internalPn: z.string().optional(),
  manufacturer: z.string().optional(),
  mpn: z.string().optional(),
  description: z.string().optional(),
  specification: z.string().optional(),
  unit: z.string().optional(),
  lifecycle: z.string().optional(),
  status: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type LabMaterial = z.infer<typeof LabMaterialSchema>;

export const LabInventorySchema = z.object({
  externalId: z.string(),
  materialCode: z.string(),
  warehouseCode: z.string().optional(),
  warehouseName: z.string().optional(),
  customerCode: z.string().optional(),
  onHandQty: DecimalStringSchema,
  availableQty: DecimalStringSchema.optional(),
  reservedQty: DecimalStringSchema.optional(),
  lotNo: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type LabInventory = z.infer<typeof LabInventorySchema>;

export const LabExcessSchema = z.object({
  externalId: z.string(),
  materialCode: z.string(),
  customerCode: z.string().optional(),
  warehouseCode: z.string().optional(),
  bookQty: DecimalStringSchema,
  availableQty: DecimalStringSchema,
  earliestInboundAt: z.string().optional(),
  sourceDocumentId: z.string().optional(),
  sourceUpdatedAt: z.string().optional(),
});
export type LabExcess = z.infer<typeof LabExcessSchema>;

export const LabSupplierSchema = z.object({
  externalId: z.string(),
  supplierCode: z.string(),
  name: z.string(),
  status: z.string().optional(),
  currency: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type LabSupplier = z.infer<typeof LabSupplierSchema>;

export const LabCustomerSchema = z.object({
  externalId: z.string(),
  customerCode: z.string(),
  name: z.string(),
  status: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type LabCustomer = z.infer<typeof LabCustomerSchema>;

export const LabExchangeRateSchema = z.object({
  baseCurrency: z.string(),
  quoteCurrency: z.string(),
  rate: DecimalStringSchema,
  rateType: z.string().optional(),
  effectiveDate: z.string(),
  source: z.string(),
});
export type LabExchangeRate = z.infer<typeof LabExchangeRateSchema>;

export const LabPurchaseOrderLineSchema = z.object({
  lineNo: z.number().int(),
  materialCode: z.string(),
  qty: DecimalStringSchema,
  unitPrice: DecimalStringSchema,
  requestedDate: z.string().optional(),
  confirmedQty: DecimalStringSchema.optional(),
  /** closed-loop:累计收货量 */
  receivedQty: DecimalStringSchema.optional(),
  eta: z.string().optional(),
  shipDate: z.string().optional(),
});
export type LabPurchaseOrderLine = z.infer<typeof LabPurchaseOrderLineSchema>;

export const LabPurchaseOrderSchema = z.object({
  externalId: z.string().optional(),
  poNumber: z.string().optional(),
  supplierCode: z.string(),
  currency: z.string(),
  orderDate: z.string(),
  requestedDate: z.string().optional(),
  status: z.enum(["OPEN", "PARTIALLY_RECEIVED", "CLOSED"]).optional(),
  idempotencyKey: z.string().optional(),
  lines: z.array(LabPurchaseOrderLineSchema),
});
export type LabPurchaseOrder = z.infer<typeof LabPurchaseOrderSchema>;

// closed-loop:收货
export const LabReceiveInputSchema = z.object({
  poExternalId: z.string().optional(),
  poNumber: z.string().optional(),
  lines: z.array(
    z.object({
      lineNo: z.number().int(),
      qty: DecimalStringSchema,
      lotNo: z.string().optional(),
      warehouseCode: z.string().optional(),
    }),
  ),
});
export type LabReceiveInput = z.infer<typeof LabReceiveInputSchema>;

export const LabEtaUpdateSchema = z.object({
  poExternalId: z.string().optional(),
  poNumber: z.string().optional(),
  lineNo: z.number().int(),
  confirmedQty: DecimalStringSchema.optional(),
  eta: z.string().optional(),
  shipDate: z.string().optional(),
});
export type LabEtaUpdate = z.infer<typeof LabEtaUpdateSchema>;

export const LabConnectionResultSchema = z.object({
  connected: z.boolean(),
  provider: z.string(),
  message: z.string(),
  checkedAt: z.string(),
});
export type LabConnectionResult = z.infer<typeof LabConnectionResultSchema>;

export const LabWriteResultSchema = z.object({
  success: z.boolean(),
  externalId: z.string().optional(),
  documentNumber: z.string().optional(),
  idempotentReplay: z.boolean().optional(),
  message: z.string().optional(),
});
export type LabWriteResult = z.infer<typeof LabWriteResultSchema>;

// LAB-1(Lab 仓库 PR #1):工单与销售订单
export const LabWorkOrderLineSchema = z.object({
  materialCode: z.string(),
  consumedQty: DecimalStringSchema,
});

export const LabWorkOrderSchema = z.object({
  externalId: z.string(),
  woNumber: z.string(),
  customerCode: z.string().optional(),
  productCode: z.string(),
  bomRef: z.string().optional(),
  qty: DecimalStringSchema,
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "SHIPPED"]),
  currentOperation: z.string().optional(),
  consumedLines: z.array(LabWorkOrderLineSchema),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
});
export type LabWorkOrder = z.infer<typeof LabWorkOrderSchema>;

export const LabSalesOrderLineSchema = z.object({
  lineNo: z.number().int(),
  productCode: z.string(),
  qty: DecimalStringSchema,
  shippedQty: DecimalStringSchema.optional(),
  requestedDate: z.string().optional(),
});

export const LabSalesOrderSchema = z.object({
  externalId: z.string(),
  soNumber: z.string(),
  customerCode: z.string(),
  status: z.string().optional(),
  lines: z.array(LabSalesOrderLineSchema),
});
export type LabSalesOrder = z.infer<typeof LabSalesOrderSchema>;

/** R3-7:库存异动 / 批次(门户 Transactions/Lots 数据源) */
export const LabInventoryMovementSchema = z.object({
  externalId: z.string(),
  materialCode: z.string(),
  movementType: z.enum(["IN", "OUT", "TRANSFER", "ADJUST"]),
  qty: DecimalStringSchema,
  warehouseCode: z.string().optional(),
  lotNo: z.string().optional(),
  customerCode: z.string().optional(),
  refDocType: z.string().optional(),
  refDocNo: z.string().optional(),
  occurredAt: z.string(),
});
export type LabInventoryMovement = z.infer<typeof LabInventoryMovementSchema>;

export const LabInventoryLotSchema = z.object({
  externalId: z.string(),
  lotNo: z.string(),
  materialCode: z.string(),
  qty: DecimalStringSchema,
  warehouseCode: z.string().optional(),
  customerCode: z.string().optional(),
  supplierCode: z.string().optional(),
  receivedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  status: z.enum(["AVAILABLE", "HOLD", "CONSUMED"]).optional(),
});
export type LabInventoryLot = z.infer<typeof LabInventoryLotSchema>;

/** R4-10:Internal PN ↔ MFG/MPN 关系(主仓 PartMfgMapping 的 ERP 侧数据源) */
export const LabMaterialMfgMappingSchema = z.object({
  externalId: z.string(),
  materialCode: z.string(),
  internalPn: z.string().optional(),
  manufacturer: z.string().optional(),
  mpn: z.string(),
  relationType: z.string().optional(),
  status: z.string().optional(),
  source: z.string(),
  sourceDocumentNo: z.string().optional(),
  sourceRow: z.number().int().optional(),
  observedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type LabMaterialMfgMapping = z.infer<typeof LabMaterialMfgMappingSchema>;

/** Lab `/api/erp` 的 RPC 操作名 —— 与 `api/erp.ts` 的 switch 分支逐字一致 */
export const LAB_OPERATIONS = [
  "testConnection",
  "pullMaterials",
  "pullInventory",
  "pullExcess",
  "pullSuppliers",
  "pullCustomers",
  "pullExchangeRates",
  "pullOpenPurchaseOrders",
  "pullWorkOrders",
  "pullSalesOrders",
  "pullInventoryMovements",
  "pullInventoryLots",
  "pullMaterialMfgMappings",
  "createPurchaseOrder",
  "updateEta",
  "receivePurchaseOrder",
] as const;
export type LabOperation = (typeof LAB_OPERATIONS)[number];

/** Lab 的 13 种故障场景码 —— 状态机分类矩阵按这份清单穷举 */
export const LAB_SCENARIO_CODES = [
  "NORMAL",
  "SLOW_ERP",
  "AUTH_EXPIRED",
  "TIMEOUT",
  "RATE_LIMIT",
  "PARTIAL_RESPONSE",
  "DUPLICATE_PO",
  "MATERIAL_NOT_FOUND",
  "SUPPLIER_NOT_FOUND",
  "FX_MISSING",
  "PO_ALREADY_EXISTS",
  "ERP_500",
  "NETWORK_DROP_AFTER_COMMIT",
  "WORK_ORDER_SOURCE_UNAVAILABLE",
] as const;
export type LabScenarioCode = (typeof LAB_SCENARIO_CODES)[number];

/** Lab API 信封:`{ok:true,data}` 或 `{ok:false,error:{code,message,retryable}}` */
export const LabEnvelopeSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
        retryable: z.boolean().optional(),
      })
      .optional(),
  }),
]);

export interface LabPullOptions {
  updatedSince?: string;
  cursor?: string;
  limit?: number;
  // closed-loop:服务端过滤(数据最小化)
  customerCode?: string;
  materialCode?: string;
  warehouseCode?: string;
}

/** closed-loop:pull* 统一分页信封(Lab 端 ErpPullPage 的镜像) */
export function labPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    cursor: z.string().optional(),
    hasMore: z.boolean(),
    total: z.number().int().nonnegative().optional(),
  });
}
