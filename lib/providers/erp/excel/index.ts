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
  /*
   * E8:Excel 通道拿不到 Excess / 汇率 / 组织。
   * 这条通道的定位是"把数据导出成 ERP 能吃的模板",不是从 ERP 读数据 ——
   * 返回空数组会被读成"ERP 里没有呆滞",所以一律抛"该通道不支持"。
   */
  async getOrganizations(): Promise<never> {
    throw new ErpNotImplementedError("EXCEL", "getOrganizations(Excel 通道不读 ERP 数据)");
  }
  async pullExcessReport(): Promise<never> {
    throw new ErpNotImplementedError(
      "EXCEL",
      "pullExcessReport(Excel 通道不读 ERP;请改用 API 通道或人工导入 Excess 表)",
    );
  }
  async pullExchangeRates(): Promise<never> {
    throw new ErpNotImplementedError("EXCEL", "pullExchangeRates(Excel 通道不读 ERP)");
  }

  async getJobStatus(_c: ErpConnectionConfig, externalJobId: string): Promise<ErpJobStatus> {
    return { externalJobId, state: "UNKNOWN", message: "Excel 通道无外部作业" };
  }

  // ---- F4:Excel 通道只出模板不发请求,单笔 API 写操作不属于这条通道 ----
  async pullSuppliers(): Promise<never> {
    throw new ErpNotImplementedError("EXCEL", "pullSuppliers(Excel 通道不读 ERP 数据)");
  }
  async pullCustomers(): Promise<never> {
    throw new ErpNotImplementedError("EXCEL", "pullCustomers(Excel 通道不读 ERP 数据)");
  }
  async createPurchaseOrder(): Promise<never> {
    throw new ErpNotImplementedError(
      "EXCEL",
      "createPurchaseOrder(Excel 通道走批量模板导出,不做单笔 API 直写)",
    );
  }
  async updateEta(): Promise<never> {
    throw new ErpNotImplementedError("EXCEL", "updateEta(Excel 通道走批量模板导出)");
  }
  async pullSalesOrders(): Promise<never> {
    throw new ErpNotImplementedError("EXCEL", "pullSalesOrders(Excel 通道不读 ERP 数据)");
  }
  async pullInventoryMovements(): Promise<never> {
    throw new ErpNotImplementedError("EXCEL", "pullInventoryMovements(Excel 通道不读 ERP 数据)");
  }
  async pullInventoryLots(): Promise<never> {
    throw new ErpNotImplementedError("EXCEL", "pullInventoryLots(Excel 通道不读 ERP 数据)");
  }
  async receivePurchaseOrder(): Promise<never> {
    throw new ErpNotImplementedError("EXCEL", "receivePurchaseOrder(Excel 通道不做单笔 API 直写)");
  }
}
