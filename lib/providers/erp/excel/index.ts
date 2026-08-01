/**
 * ExcelErpProvider —— **一期真实可用**的兜底通道(客户无 ERP API 时用)。
 *
 * 语义要说清楚:
 * - `pull*` 读的是**用户上传的表格**(经 config.uploadedRows 传入),不是任何 ERP 接口;
 * - `push*` 只产出 ERP 可导入的行数据,`writtenToErp=false` —— **导出不代表 ERP 已接单**。
 */
import {
  ErpNotImplementedError,
  type ConnectionTestResult,
  type ErpConnectionConfig,
  type ErpInventory,
  type ErpJobStatus,
  type ErpMaterial,
  type ErpMetadata,
  type ErpOpenPo,
  type ErpPage,
  type ErpProvider,
  type ErpPushResult,
  type ErpWorkOrder,
} from "../types";

/** 上传的表格行由调用方放进 config.config.uploadedRows[entity] */
function rows<T>(config: ErpConnectionConfig, entity: string): T[] {
  const bag = config.config?.uploadedRows as Record<string, unknown> | undefined;
  const list = bag?.[entity];
  return Array.isArray(list) ? (list as T[]) : [];
}

function page<T>(items: T[]): ErpPage<T> {
  return { items, page: { cursor: null, hasMore: false, total: items.length } };
}

export class ExcelErpProvider implements ErpProvider {
  readonly vendor = "EXCEL";

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      ok: true,
      responseMs: 0,
      erpVersion: null,
      organization: null,
      capabilities: ["pullMaterials", "pullInventory", "pullOpenPurchaseOrders", "pullWorkOrders"],
      failureReason: null,
      // 诚实:这条通道根本不连任何系统
      suggestion: "Excel 通道不连接任何 ERP —— 数据来自你上传的表格,导出的模板需人工导入 ERP",
      testedAt: new Date().toISOString(),
    };
  }

  async getMetadata(): Promise<ErpMetadata> {
    return {
      vendor: "EXCEL",
      edition: null,
      entityFields: {
        MATERIAL: ["内部料号", "MPN", "制造商", "描述", "封装", "单位", "MOQ", "SPQ", "交期", "生命周期", "状态"],
        INVENTORY: ["仓库", "库位", "内部料号", "批次", "数量", "锁定数量", "可用数量", "DC", "入库时间"],
        OPEN_PO: ["PO", "行号", "供应商", "内部料号", "MPN", "订单数量", "已收数量", "未交数量", "ETA", "币种", "单价"],
        WORK_ORDER: ["工单号", "产品", "BOM版本", "计划数量", "开始时间", "需求日期", "状态"],
      },
      capabilities: ["pullMaterials", "pullInventory", "pullOpenPurchaseOrders", "pullWorkOrders"],
      notImplemented: ["pushMaterials(改用导出模板)"],
    };
  }

  async pullMaterials(config: ErpConnectionConfig): Promise<ErpPage<ErpMaterial>> {
    return page(rows<ErpMaterial>(config, "MATERIAL"));
  }
  async pullInventory(config: ErpConnectionConfig): Promise<ErpPage<ErpInventory>> {
    return page(rows<ErpInventory>(config, "INVENTORY"));
  }
  async pullOpenPurchaseOrders(config: ErpConnectionConfig): Promise<ErpPage<ErpOpenPo>> {
    return page(rows<ErpOpenPo>(config, "OPEN_PO"));
  }
  async pullWorkOrders(config: ErpConnectionConfig): Promise<ErpPage<ErpWorkOrder>> {
    return page(rows<ErpWorkOrder>(config, "WORK_ORDER"));
  }

  async pushMaterials(): Promise<ErpPushResult> {
    throw new ErpNotImplementedError("EXCEL", "pushMaterials —— 请使用「导出 ERP 模板」");
  }
  async pushPurchaseOrders(_c: ErpConnectionConfig, items: ErpOpenPo[]): Promise<ErpPushResult> {
    return {
      accepted: items.length,
      rejected: 0,
      externalJobId: null,
      failures: [],
      writtenToErp: false,
      note: "已产出可导入 ERP 的行数据;**导出不代表 ERP 已接单**,需人工/RPA 导入",
    };
  }
  async pushEtaUpdates(
    _c: ErpConnectionConfig,
    items: { poNo: string; lineNo: number; eta: string | null; qty: string | null }[],
  ): Promise<ErpPushResult> {
    return {
      accepted: items.length,
      rejected: 0,
      externalJobId: null,
      failures: [],
      writtenToErp: false,
      note: "已产出 ETA 回写模板;**回写待人工导入 ERP**",
    };
  }
  async getJobStatus(_c: ErpConnectionConfig, externalJobId: string): Promise<ErpJobStatus> {
    return { externalJobId, state: "UNKNOWN", message: "Excel 通道无外部作业" };
  }
}
