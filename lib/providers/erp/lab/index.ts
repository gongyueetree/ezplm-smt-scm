/**
 * HttpErpLabProvider —— 调用 ERP 仿真环境(gongyueetree/ezplm-erp-lab)的真实 HTTP 实现。
 *
 * 定位必须说清:Lab 是**联调目标**,不是金蝶。UI 一律标「ERP 仿真环境」,
 * 打通 Lab 只证明"本系统的同步状态机与幂等重试是对的",不证明"金蝶已联调"。
 *
 * 通信形态(与 Lab `api/erp.ts` 逐字对齐):
 * - `POST {ERP_LAB_BASE_URL}/api/erp`,body `{tenantId, operation, payload}`;
 * - 写操作(生产环境)要求 `Authorization: Bearer {ERP_LAB_ACCESS_TOKEN}`;
 * - 响应信封 `{ok:true,data}` / `{ok:false,error:{code,message,retryable}}`。
 *
 * 两条纪律:
 * - **Token 只存服务端环境变量**,不落库、不回传、不写日志;
 * - Lab 返回的数据先过镜像 Schema(`./contract.ts`)再换算成本系统 DTO ——
 *   字段漂移在这里炸出来,而不是静默丢列。
 */
import { z } from "zod";
import {
  ErpNotConfiguredError,
  type ConnectionTestResult,
  type ErpConnectionConfig,
  type ErpCreatePoInput,
  type ErpCustomerRecord,
  type ErpEtaUpdateInput,
  type ErpExcessLine,
  type ErpFxRate,
  type ErpInventory,
  type ErpJobStatus,
  type ErpMaterial,
  type ErpMetadata,
  type ErpOpenPo,
  type ErpOrganization,
  type ErpPage,
  type ErpProvider,
  type ErpPushResult,
  type ErpReceiveInputMain,
  type ErpInventoryLot,
  type ErpInventoryMovement,
  type ErpSalesOrderRecord,
  type ErpSupplierRecord,
  type ErpWorkOrder,
  type ErpWriteResult,
} from "../types";
import {
  labPageSchema,
  LabConnectionResultSchema,
  LabCustomerSchema,
  LabInventoryLotSchema,
  LabInventoryMovementSchema,
  LabSalesOrderSchema,
  LabWorkOrderSchema,
  LabEnvelopeSchema,
  LabExcessSchema,
  LabExchangeRateSchema,
  LabInventorySchema,
  LabMaterialSchema,
  LabPurchaseOrderSchema,
  LabSupplierSchema,
  LabWriteResultSchema,
  type LabOperation,
  type LabPullOptions,
} from "./contract";

/** Lab 侧错误 → 携带 code/retryable 的结构化错误(状态机据此分类,见 lib/domain/integration-sync.ts) */
export class ErpLabRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "ErpLabRequestError";
  }
}

export interface ErpLabEnv {
  baseUrl: string;
  accessToken: string;
  tenantId: string;
}

/**
 * 从环境变量解析 Lab 目标;缺失时返回 null(调用方落 NOT_CONFIGURED,不发请求)。
 * `labTenantId` 是 Lab 侧的数据集租户名,默认 Lab 自己的默认值。
 */
export function resolveErpLabEnv(labTenantId?: string | null): ErpLabEnv | null {
  const baseUrl = process.env.ERP_LAB_BASE_URL?.trim();
  const accessToken = process.env.ERP_LAB_ACCESS_TOKEN?.trim();
  if (!baseUrl || !accessToken) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), accessToken, tenantId: labTenantId?.trim() || "ezplm-demo" };
}

const TIMEOUT_MS = 15_000;

const opt = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);

export class HttpErpLabProvider implements ErpProvider {
  readonly vendor = "ERP_LAB";

  /** env=null 表示环境变量未配置:一切调用抛 NotConfigured,不发任何请求 */
  constructor(private readonly envOrNull: ErpLabEnv | null) {}

  private get env(): ErpLabEnv {
    if (!this.envOrNull) {
      throw new ErpNotConfiguredError("ERP_LAB", ["ERP_LAB_BASE_URL", "ERP_LAB_ACCESS_TOKEN"]);
    }
    return this.envOrNull;
  }

  private async rpc<T>(
    operation: LabOperation,
    schema: z.ZodType<T>,
    payload: Record<string, unknown> = {},
    correlationId?: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.env.baseUrl}/api/erp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": this.env.tenantId,
          Authorization: `Bearer ${this.env.accessToken}`,
          // closed-loop P1-10:业务动作 → 同步记录 → Lab 请求日志 一条链
          ...(correlationId ? { "X-Correlation-Id": correlationId } : {}),
        },
        body: JSON.stringify({ tenantId: this.env.tenantId, operation, payload }),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new ErpLabRequestError("ERP_TIMEOUT", `ERP 仿真环境 ${TIMEOUT_MS / 1000}s 未响应`, true, 504);
      }
      // 网络层失败(DNS/连接拒绝):瞬态,可重试
      throw new ErpLabRequestError(
        "NETWORK_ERROR",
        `无法连接 ERP 仿真环境:${e instanceof Error ? e.message : "network error"}`,
        true,
        0,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let envelope: z.infer<typeof LabEnvelopeSchema>;
    try {
      envelope = LabEnvelopeSchema.parse(JSON.parse(text));
    } catch {
      throw new ErpLabRequestError(
        res.status >= 500 ? "ERP_INTERNAL_ERROR" : "INVALID_API_RESPONSE",
        `ERP 仿真环境返回非法响应(HTTP ${res.status})`,
        res.status >= 500,
        res.status,
      );
    }
    if (!res.ok || !envelope.ok) {
      const err = envelope.ok ? undefined : envelope.error;
      throw new ErpLabRequestError(
        err?.code ?? "HTTP_PROVIDER_ERROR",
        err?.message ?? `ERP 仿真环境请求失败(HTTP ${res.status})`,
        Boolean(err?.retryable),
        res.status,
      );
    }
    return schema.parse((envelope as { ok: true; data: unknown }).data);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    if (!this.envOrNull) {
      return {
        ok: false,
        responseMs: 0,
        erpVersion: null,
        organization: null,
        capabilities: [],
        failureReason: "缺少环境变量 ERP_LAB_BASE_URL / ERP_LAB_ACCESS_TOKEN —— 未发起任何请求",
        suggestion: "在服务端环境变量中配置 Lab 部署地址与访问令牌(仅服务端,不入库不回传)",
        testedAt: new Date().toISOString(),
      };
    }
    try {
      const r = await this.rpc("testConnection", LabConnectionResultSchema);
      return {
        ok: r.connected,
        responseMs: Date.now() - startedAt,
        erpVersion: r.provider,
        organization: this.env.tenantId,
        capabilities: [
          "pullMaterials",
          "pullInventory",
          "pullOpenPurchaseOrders",
          "pushPurchaseOrders",
          "pushEtaUpdates",
        ],
        failureReason: r.connected ? null : r.message,
        suggestion: r.connected
          ? "已连通 ERP **仿真环境**(ezplm-erp-lab)—— 这不是金蝶,金蝶联调仍待客户凭据(O1)"
          : "检查 ERP_LAB_BASE_URL 与 Lab 部署状态",
        testedAt: new Date().toISOString(),
      };
    } catch (e) {
      return {
        ok: false,
        responseMs: Date.now() - startedAt,
        erpVersion: null,
        organization: null,
        capabilities: [],
        failureReason: e instanceof Error ? e.message : "连接失败",
        suggestion: "检查 ERP_LAB_BASE_URL / ERP_LAB_ACCESS_TOKEN 环境变量与 Lab 部署",
        testedAt: new Date().toISOString(),
      };
    }
  }

  async getMetadata(): Promise<ErpMetadata> {
    return {
      vendor: "ERP_LAB",
      edition: "仿真环境",
      entityFields: {
        MATERIAL: ["externalId", "materialCode", "internalPn", "mpn", "manufacturer", "description"],
        INVENTORY: ["externalId", "materialCode", "warehouseCode", "customerCode", "onHandQty", "availableQty", "lotNo"],
        EXCESS: ["externalId", "materialCode", "customerCode", "bookQty", "availableQty", "earliestInboundAt"],
        SUPPLIER: ["externalId", "supplierCode", "name", "currency"],
        CUSTOMER: ["externalId", "customerCode", "name"],
        OPEN_PO: ["externalId", "poNumber", "supplierCode", "currency", "lines"],
      },
      capabilities: ["pullMaterials", "pullInventory", "pullOpenPurchaseOrders", "pushPurchaseOrders", "pushEtaUpdates"],
      notImplemented: [],
    };
  }

  private pullInput(input: {
    cursor?: string | null;
    limit?: number;
    since?: string | null;
    customerCode?: string | null;
    materialCode?: string | null;
    warehouseCode?: string | null;
  }): LabPullOptions {
    return {
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
      ...(input.since ? { updatedSince: input.since } : {}),
      ...(input.customerCode ? { customerCode: input.customerCode } : {}),
      ...(input.materialCode ? { materialCode: input.materialCode } : {}),
      ...(input.warehouseCode ? { warehouseCode: input.warehouseCode } : {}),
    };
  }

  /** Lab 分页信封 → 本系统 ErpPage(**真实 cursor/hasMore/total 透传**,不再假装单页) */
  private toPage<T, U>(page: { items: T[]; cursor?: string; hasMore: boolean; total?: number }, map: (x: T) => U): ErpPage<U> {
    return {
      items: page.items.map(map),
      page: { cursor: page.cursor ?? null, hasMore: page.hasMore, total: page.total ?? null },
    };
  }

  async pullMaterials(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null }): Promise<ErpPage<ErpMaterial>> {
    const p = await this.rpc("pullMaterials", labPageSchema(LabMaterialSchema), { input: this.pullInput(input) });
    return this.toPage(p, (m) => ({
        externalId: m.externalId,
        internalPn: opt(m.internalPn) ?? opt(m.materialCode),
        mpn: opt(m.mpn),
        manufacturer: opt(m.manufacturer),
        description: opt(m.description) ?? opt(m.specification),
        footprint: null,
        unit: opt(m.unit),
        moq: null,
        spq: null,
        leadTimeDays: null,
        lifecycle: opt(m.lifecycle),
        status: opt(m.status),
        updatedAt: opt(m.updatedAt),
      }));
  }

  async pushMaterials(): Promise<ErpPushResult> {
    throw new ErpNotConfiguredError("ERP_LAB", ["Lab 合约无 pushMaterials(主数据单一真源,本系统不回写物料)"]);
  }

  async pullInventory(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null }): Promise<ErpPage<ErpInventory>> {
    const p = await this.rpc("pullInventory", labPageSchema(LabInventorySchema), { input: this.pullInput(input) });
    return this.toPage(p, (r) => ({
        warehouse: opt(r.warehouseName) ?? opt(r.warehouseCode),
        location: null,
        internalPn: opt(r.materialCode),
        lotNo: opt(r.lotNo),
        qty: r.onHandQty,
        lockedQty: opt(r.reservedQty),
        availableQty: opt(r.availableQty),
        dateCode: null,
        receivedAt: null,
        materialCode: opt(r.materialCode),
        customerCode: opt(r.customerCode),
      }));
  }

  async pullOpenPurchaseOrders(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null }): Promise<ErpPage<ErpOpenPo>> {
    const p = await this.rpc("pullOpenPurchaseOrders", labPageSchema(LabPurchaseOrderSchema), { input: this.pullInput(input) });
    // 展开为行级;分页信息按 PO 粒度透传(行级展开不改变 hasMore/cursor 语义)
    return {
      items: p.items.flatMap((po) =>
        po.lines.map((l) => ({
          poNo: po.poNumber ?? po.externalId ?? "",
          lineNo: l.lineNo,
          supplier: po.supplierCode,
          internalPn: l.materialCode,
          mpn: null,
          qtyOrdered: l.qty,
          qtyReceived: null,
          qtyOpen: null,
          eta: opt(l.eta),
          currency: po.currency,
          unitPrice: l.unitPrice,
        })),
      ),
      page: { cursor: p.cursor ?? null, hasMore: p.hasMore, total: p.total ?? null },
    };
  }

  // LAB-1 落地后接入:Lab WO → 本系统 ErpWorkOrder(status/bomRef 原样带出)
  async pullWorkOrders(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null }): Promise<ErpPage<ErpWorkOrder>> {
    const p = await this.rpc("pullWorkOrders", labPageSchema(LabWorkOrderSchema), { input: this.pullInput(input) });
    return this.toPage(p, (w) => ({
        workOrderNo: w.woNumber,
        product: w.productCode,
        bomVersion: opt(w.bomRef),
        plannedQty: w.qty,
        startAt: opt(w.plannedStart),
        needDate: opt(w.plannedEnd),
        status: w.status,
      }));
  }

  // LAB-1:销售订单(客户需求侧;F2 影响分析与客户告知消费)
  async pullSalesOrders(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null }): Promise<ErpPage<ErpSalesOrderRecord>> {
    const p = await this.rpc("pullSalesOrders", labPageSchema(LabSalesOrderSchema), { input: this.pullInput(input) });
    return this.toPage(p, (so) => ({
        externalId: so.externalId,
        soNumber: so.soNumber,
        customerCode: so.customerCode,
        status: opt(so.status),
        lines: so.lines.map((l) => ({
          lineNo: l.lineNo,
          productCode: l.productCode,
          qty: l.qty,
          shippedQty: opt(l.shippedQty),
          requestedDate: opt(l.requestedDate),
        })),
      }));
  }

  // R3-7:门户 Transactions/Lots 数据源
  async pullInventoryMovements(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null; customerCode?: string | null; materialCode?: string | null; warehouseCode?: string | null }): Promise<ErpPage<ErpInventoryMovement>> {
    const p = await this.rpc("pullInventoryMovements", labPageSchema(LabInventoryMovementSchema), { input: this.pullInput(input) });
    return this.toPage(p, (m) => ({
      externalId: m.externalId,
      materialCode: m.materialCode,
      movementType: m.movementType,
      qty: m.qty,
      warehouseCode: opt(m.warehouseCode),
      lotNo: opt(m.lotNo),
      customerCode: opt(m.customerCode),
      refDocType: opt(m.refDocType),
      refDocNo: opt(m.refDocNo),
      occurredAt: m.occurredAt,
    }));
  }

  async pullInventoryLots(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null; customerCode?: string | null; materialCode?: string | null; warehouseCode?: string | null }): Promise<ErpPage<ErpInventoryLot>> {
    const p = await this.rpc("pullInventoryLots", labPageSchema(LabInventoryLotSchema), { input: this.pullInput(input) });
    return this.toPage(p, (l) => ({
      externalId: l.externalId,
      lotNo: l.lotNo,
      materialCode: l.materialCode,
      qty: l.qty,
      warehouseCode: opt(l.warehouseCode),
      customerCode: opt(l.customerCode),
      supplierCode: opt(l.supplierCode),
      receivedAt: opt(l.receivedAt),
      expiresAt: opt(l.expiresAt),
      status: opt(l.status),
    }));
  }

  async pushPurchaseOrders(): Promise<ErpPushResult> {
    throw new ErpNotConfiguredError("ERP_LAB", [
      "Lab 走单笔 createPurchaseOrder(带幂等键),不提供批量 push —— 请经同步状态机逐单回写",
    ]);
  }

  async pushEtaUpdates(): Promise<ErpPushResult> {
    throw new ErpNotConfiguredError("ERP_LAB", ["Lab 走单笔 updateEta —— 请经同步状态机逐行回写"]);
  }

  async getJobStatus(_c: ErpConnectionConfig, externalJobId: string): Promise<ErpJobStatus> {
    return { externalJobId, state: "UNKNOWN", message: "Lab 写操作同步返回结果,无异步作业" };
  }

  async getOrganizations(): Promise<ErpOrganization[]> {
    return [{ externalId: this.env.tenantId, code: this.env.tenantId, name: `Lab 数据集(${this.env.tenantId})` }];
  }

  async pullExcessReport(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null }): Promise<ErpPage<ErpExcessLine>> {
    const p = await this.rpc("pullExcess", labPageSchema(LabExcessSchema), { input: this.pullInput(input) });
    return this.toPage(p, (r) => ({
        externalId: r.externalId,
        internalPn: opt(r.materialCode),
        mpn: null,
        qty: r.bookQty,
        usableQty: r.availableQty,
        warehouse: opt(r.warehouseCode),
        customerCode: opt(r.customerCode),
        lotNo: null,
        earliestInboundAt: opt(r.earliestInboundAt),
        sourceDocumentId: opt(r.sourceDocumentId),
        sourceUpdatedAt: opt(r.sourceUpdatedAt),
      }));
  }

  async pullExchangeRates(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null }): Promise<ErpPage<ErpFxRate>> {
    const p = await this.rpc("pullExchangeRates", labPageSchema(LabExchangeRateSchema), { input: this.pullInput(input) });
    return this.toPage(p, (r) => ({
        sourceCurrency: r.baseCurrency,
        targetCurrency: r.quoteCurrency,
        rate: r.rate,
        rateType: opt(r.rateType),
        effectiveDate: r.effectiveDate,
        sourceUpdatedAt: null,
      }));
  }

  async pullSuppliers(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null }): Promise<ErpPage<ErpSupplierRecord>> {
    const p = await this.rpc("pullSuppliers", labPageSchema(LabSupplierSchema), { input: this.pullInput(input) });
    return this.toPage(p, (r) => ({
        externalId: r.externalId,
        supplierCode: r.supplierCode,
        name: r.name,
        status: opt(r.status),
        currency: opt(r.currency),
        updatedAt: opt(r.updatedAt),
      }));
  }

  async pullCustomers(_c: ErpConnectionConfig, input: { cursor?: string | null; limit?: number; since?: string | null }): Promise<ErpPage<ErpCustomerRecord>> {
    const p = await this.rpc("pullCustomers", labPageSchema(LabCustomerSchema), { input: this.pullInput(input) });
    return this.toPage(p, (r) => ({
        externalId: r.externalId,
        customerCode: r.customerCode,
        name: r.name,
        status: opt(r.status),
        updatedAt: opt(r.updatedAt),
      }));
  }

  async createPurchaseOrder(
    config: ErpConnectionConfig,
    input: ErpCreatePoInput,
    idempotencyKey: string,
  ): Promise<ErpWriteResult> {
    const r = await this.rpc("createPurchaseOrder", LabWriteResultSchema, {
      input: {
        supplierCode: input.supplierCode,
        currency: input.currency,
        orderDate: input.orderDate,
        ...(input.requestedDate ? { requestedDate: input.requestedDate } : {}),
        lines: input.lines.map((l) => ({
          lineNo: l.lineNo,
          materialCode: l.materialCode,
          qty: l.qty,
          unitPrice: l.unitPrice,
          ...(l.requestedDate ? { requestedDate: l.requestedDate } : {}),
        })),
      },
      idempotencyKey,
    }, typeof config.config?.correlationId === "string" ? config.config.correlationId : undefined);
    return {
      success: r.success,
      externalId: r.externalId ?? null,
      documentNumber: r.documentNumber ?? null,
      idempotentReplay: r.idempotentReplay ?? false,
      message: r.message ?? null,
    };
  }

  async receivePurchaseOrder(
    config: ErpConnectionConfig,
    input: ErpReceiveInputMain,
    idempotencyKey: string,
  ): Promise<ErpWriteResult> {
    const r = await this.rpc(
      "receivePurchaseOrder",
      LabWriteResultSchema,
      {
        input: {
          ...(input.poExternalId ? { poExternalId: input.poExternalId } : {}),
          ...(input.poNumber ? { poNumber: input.poNumber } : {}),
          lines: input.lines.map((l) => ({
            lineNo: l.lineNo,
            qty: l.qty,
            ...(l.lotNo ? { lotNo: l.lotNo } : {}),
            ...(l.warehouseCode ? { warehouseCode: l.warehouseCode } : {}),
          })),
        },
        idempotencyKey,
      },
      typeof config.config?.correlationId === "string" ? config.config.correlationId : undefined,
    );
    return {
      success: r.success,
      externalId: r.externalId ?? null,
      documentNumber: r.documentNumber ?? null,
      idempotentReplay: r.idempotentReplay ?? false,
      message: r.message ?? null,
    };
  }

  async updateEta(config: ErpConnectionConfig, input: ErpEtaUpdateInput): Promise<ErpWriteResult> {
    const r = await this.rpc("updateEta", LabWriteResultSchema, {
      input: {
        ...(input.poExternalId ? { poExternalId: input.poExternalId } : {}),
        ...(input.poNumber ? { poNumber: input.poNumber } : {}),
        lineNo: input.lineNo,
        ...(input.confirmedQty ? { confirmedQty: input.confirmedQty } : {}),
        ...(input.eta ? { eta: input.eta } : {}),
        ...(input.shipDate ? { shipDate: input.shipDate } : {}),
      },
    }, typeof config.config?.correlationId === "string" ? config.config.correlationId : undefined);
    return {
      success: r.success,
      externalId: r.externalId ?? null,
      documentNumber: r.documentNumber ?? null,
      idempotentReplay: r.idempotentReplay ?? false,
      message: r.message ?? null,
    };
  }
}
