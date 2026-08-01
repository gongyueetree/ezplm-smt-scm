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
