/**
 * ERP Provider 数据契约。
 *
 * 业务代码**不得**判断"金蝶还是用友" —— 一律经本接口。
 * 与既有 ezPLM/DigiKey Provider 同一套做法:Zod 契约 + Mock/真实双实现 + 合同测试。
 */
import { z } from "zod";

export const ErpCapabilitySchema = z.enum([
  "pullMaterials",
  "pushMaterials",
  "pullInventory",
  "pullOpenPurchaseOrders",
  "pullWorkOrders",
  "pushPurchaseOrders",
  "pushEtaUpdates",
  "receiptLots",
  "shipments",
]);
export type ErpCapability = z.infer<typeof ErpCapabilitySchema>;

export const ConnectionTestResultSchema = z.object({
  ok: z.boolean(),
  /** 响应时间(ms);失败时也要给,便于区分"打不通"与"通了但拒绝" */
  responseMs: z.number().int().nonnegative(),
  erpVersion: z.string().nullable(),
  /** 组织/账套 */
  organization: z.string().nullable(),
  capabilities: z.array(ErpCapabilitySchema),
  /** 失败原因与建议动作 —— 不是一句"连接失败"了事 */
  failureReason: z.string().nullable(),
  suggestion: z.string().nullable(),
  testedAt: z.string(),
});
export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>;

export const ErpMetadataSchema = z.object({
  vendor: z.string(),
  edition: z.string().nullable(),
  /** 各实体的可用字段,供字段映射页做下拉 */
  entityFields: z.record(z.string(), z.array(z.string())),
  capabilities: z.array(ErpCapabilitySchema),
  /** 未联调的实体在此列明,UI 显示「待联调」 */
  notImplemented: z.array(z.string()).default([]),
});
export type ErpMetadata = z.infer<typeof ErpMetadataSchema>;

/** 通用分页 */
export const PageInfoSchema = z.object({
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
  total: z.number().int().nonnegative().nullable(),
});

export const ErpMaterialSchema = z.object({
  externalId: z.string(),
  internalPn: z.string().nullable(),
  mpn: z.string().nullable(),
  manufacturer: z.string().nullable(),
  description: z.string().nullable(),
  footprint: z.string().nullable(),
  unit: z.string().nullable(),
  moq: z.number().int().nullable(),
  spq: z.number().int().nullable(),
  leadTimeDays: z.number().int().nullable(),
  lifecycle: z.string().nullable(),
  status: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type ErpMaterial = z.infer<typeof ErpMaterialSchema>;

export const ErpInventorySchema = z.object({
  warehouse: z.string().nullable(),
  location: z.string().nullable(),
  internalPn: z.string().nullable(),
  lotNo: z.string().nullable(),
  qty: z.string(),
  lockedQty: z.string().nullable(),
  availableQty: z.string().nullable(),
  dateCode: z.string().nullable(),
  receivedAt: z.string().nullable(),
});
export type ErpInventory = z.infer<typeof ErpInventorySchema>;

export const ErpOpenPoSchema = z.object({
  poNo: z.string(),
  lineNo: z.number().int(),
  supplier: z.string().nullable(),
  internalPn: z.string().nullable(),
  mpn: z.string().nullable(),
  qtyOrdered: z.string(),
  qtyReceived: z.string().nullable(),
  qtyOpen: z.string().nullable(),
  eta: z.string().nullable(),
  currency: z.string().nullable(),
  unitPrice: z.string().nullable(),
});
export type ErpOpenPo = z.infer<typeof ErpOpenPoSchema>;

export const ErpWorkOrderSchema = z.object({
  workOrderNo: z.string(),
  product: z.string().nullable(),
  bomVersion: z.string().nullable(),
  plannedQty: z.string(),
  startAt: z.string().nullable(),
  needDate: z.string().nullable(),
  status: z.string().nullable(),
});
export type ErpWorkOrder = z.infer<typeof ErpWorkOrderSchema>;

export const ErpPushResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  /** ERP 侧作业号(可回查) */
  externalJobId: z.string().nullable(),
  /** 逐条失败原因 */
  failures: z.array(z.object({ bizKey: z.string(), reason: z.string() })).default([]),
  /**
   * **是否真的写进了 ERP**。
   * Excel Provider 只产出模板文件,accepted 不代表 ERP 已接单 —— 用本字段区分。
   */
  writtenToErp: z.boolean(),
  note: z.string().nullable(),
});
export type ErpPushResult = z.infer<typeof ErpPushResultSchema>;

export const ErpJobStatusSchema = z.object({
  externalJobId: z.string(),
  state: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN"]),
  message: z.string().nullable(),
});
export type ErpJobStatus = z.infer<typeof ErpJobStatusSchema>;

export interface ErpConnectionConfig {
  vendor: string;
  edition?: string | null;
  /** 非敏感配置 */
  config: Record<string, unknown>;
  /** 解密后的凭据 —— **只在即将发起调用时传入,不得落日志** */
  secrets: Record<string, string>;
}

export interface PullInput {
  cursor?: string | null;
  limit?: number;
  /** 增量水位 */
  since?: string | null;
}

export interface ErpPage<T> {
  items: T[];
  page: z.infer<typeof PageInfoSchema>;
}

/**
 * 统一 ERP 接口。
 *
 * 未实现的能力**必须抛 `ErpNotImplementedError`**,不得返回空数组冒充"没数据" ——
 * 空数组会被上层当成"同步完成、0 条",从而掩盖"这个厂商压根没接"。
 */
/**
 * E8:ERP Excess Report(客户 Q1:「ERP 有 Excess report 可以引用,
 * **但一定要引用到 AI 系统中**」)。
 *
 * 字段样例尚未拿到(O2),所以这里定的是**我们需要什么**,
 * 而不是"金蝶一定长这样" —— 拿到样表后按实际字段调整映射,
 * Zod 会在解析时直接把差异暴露出来,而不是悄悄少几列。
 */
export const ErpExcessLineSchema = z.object({
  externalId: z.string(),
  internalPn: z.string().nullable(),
  /**
   * MPN。客户备注(2026-08 回复清单第 2 项):Excess Report 本身**没有** MPN,
   * 需要额外抓取 —— 从采购订单带出,或多 MPN 时走金蝶二开接口。
   * 所以联调时这个字段可能来自**另一次查询**,为空是常态,不算数据缺陷。
   */
  mpn: z.string().nullable(),
  /** 账面量 */
  qty: z.string(),
  /** 可动用量。**与账面量分开** —— 有些呆滞已锁定/待报废,不能拿去抵采购 */
  usableQty: z.string().nullable(),
  warehouse: z.string().nullable(),
  /** 归属客户;为空表示公共库存。跨客户占用是**业务规则**,不由系统默认 */
  customerCode: z.string().nullable(),
  lotNo: z.string().nullable(),
  /**
   * 最早入库时间(客户 2026-08 要求):Excess Report 只有「最后变动时间」,
   * 库龄要按**最早入库**算 —— 用最后变动时间算库龄会把老库存算年轻。
   * 客户说报表可以增加此列;拿不到时为空,库龄显示「未知」而不是猜。
   */
  earliestInboundAt: z.string().nullable(),
  /** ERP 侧的报表/单据号 —— 追溯"这批数据出自哪一次导出" */
  sourceDocumentId: z.string().nullable(),
  /** ERP 侧的数据更新时间(不是我们导入的时间) */
  sourceUpdatedAt: z.string().nullable(),
});
export type ErpExcessLine = z.infer<typeof ErpExcessLineSchema>;

/**
 * E8:ERP 汇率(客户 Q8:「ERP 系统有汇率显示,请引用」)。
 *
 * 「有效日期」口径未定(O3):即期 / 月度锁定 / 集团内部价,
 * 一天多条时以哪条为准也没说。所以 `rateType` 与 `effectiveDate` 都留字段,
 * **不在代码里替客户选一种**。
 */
export const ErpFxRateSchema = z.object({
  sourceCurrency: z.string(),
  targetCurrency: z.string(),
  /** 汇率值,字符串保精度 —— 汇率参与金额换算,不能走浮点 */
  rate: z.string(),
  /** 汇率类型(即期/月度/内部价…),ERP 原文 */
  rateType: z.string().nullable(),
  effectiveDate: z.string(),
  sourceUpdatedAt: z.string().nullable(),
});
export type ErpFxRate = z.infer<typeof ErpFxRateSchema>;

/** 组织/账套 —— 金蝶多组织时必须先选对,否则拉回来的是别家的数据 */
export const ErpOrganizationSchema = z.object({
  externalId: z.string(),
  code: z.string(),
  name: z.string(),
});
export type ErpOrganization = z.infer<typeof ErpOrganizationSchema>;

export interface ErpProvider {
  readonly vendor: string;
  testConnection(config: ErpConnectionConfig): Promise<ConnectionTestResult>;
  getMetadata(config: ErpConnectionConfig): Promise<ErpMetadata>;

  pullMaterials(config: ErpConnectionConfig, input: PullInput): Promise<ErpPage<ErpMaterial>>;
  pushMaterials(config: ErpConnectionConfig, items: ErpMaterial[]): Promise<ErpPushResult>;

  pullInventory(config: ErpConnectionConfig, input: PullInput): Promise<ErpPage<ErpInventory>>;
  pullOpenPurchaseOrders(config: ErpConnectionConfig, input: PullInput): Promise<ErpPage<ErpOpenPo>>;
  pullWorkOrders(config: ErpConnectionConfig, input: PullInput): Promise<ErpPage<ErpWorkOrder>>;

  pushPurchaseOrders(config: ErpConnectionConfig, items: ErpOpenPo[]): Promise<ErpPushResult>;
  pushEtaUpdates(
    config: ErpConnectionConfig,
    items: { poNo: string; lineNo: number; eta: string | null; qty: string | null }[],
  ): Promise<ErpPushResult>;

  getJobStatus(config: ErpConnectionConfig, externalJobId: string): Promise<ErpJobStatus>;

  /** E8:组织/账套列表。多组织 ERP 必须先选对账套 */
  getOrganizations(config: ErpConnectionConfig): Promise<ErpOrganization[]>;
  /** E8:Excess Report(客户 Q1) */
  pullExcessReport(config: ErpConnectionConfig, input: PullInput): Promise<ErpPage<ErpExcessLine>>;
  /** E8:汇率(客户 Q8) */
  pullExchangeRates(config: ErpConnectionConfig, input: PullInput): Promise<ErpPage<ErpFxRate>>;
}

/** 未实现:与"没有数据"必须区分开 */
export class ErpNotImplementedError extends Error {
  constructor(
    readonly vendor: string,
    readonly capability: string,
  ) {
    super(`${vendor} 的「${capability}」尚未联调 —— 当前为 Adapter 骨架,不是"无数据"`);
    this.name = "ErpNotImplementedError";
  }
}

/** 连接未配置(缺凭据):与"连接失败"也要区分 */
export class ErpNotConfiguredError extends Error {
  constructor(
    readonly vendor: string,
    readonly missing: string[],
  ) {
    super(`${vendor} 连接缺少必填配置:${missing.join("、")} —— 状态为「待联调」,未发起任何请求`);
    this.name = "ErpNotConfiguredError";
  }
}
