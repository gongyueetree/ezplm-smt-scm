/**
 * MockErpProvider:全能力可用,作为**合同测试基准**与无凭据时的演示数据源。
 *
 * 诚实纪律:Mock 返回的数据在 UI 上必须标注「示例数据」,
 * 连接状态也不得因为 Mock 通了就显示成"已连接真实 ERP"。
 */
import type {
  ConnectionTestResult,
  ErpConnectionConfig,
  ErpInventory,
  ErpJobStatus,
  ErpMaterial,
  ErpMetadata,
  ErpOpenPo,
  ErpPage,
  ErpProvider,
  ErpPushResult,
  ErpWorkOrder,
} from "../types";

const MATERIALS: ErpMaterial[] = [
  {
    externalId: "M-0001",
    internalPn: "QC-IC-0001",
    mpn: "STM32F103C8T6",
    manufacturer: "STMicroelectronics",
    description: "MCU ARM Cortex-M3 64KB Flash LQFP-48",
    footprint: "LQFP-48",
    unit: "PCS",
    moq: 100,
    spq: 100,
    leadTimeDays: 30,
    lifecycle: "ACTIVE",
    status: "启用",
    updatedAt: "2026-07-20T08:00:00.000Z",
  },
  {
    externalId: "M-0002",
    internalPn: "QC-RC-0104",
    mpn: "GRM188R71H104KA93D",
    manufacturer: "Murata",
    description: "CAP CER 0.1uF 50V X7R 0603",
    footprint: "0603",
    unit: "PCS",
    moq: 4000,
    spq: 4000,
    leadTimeDays: 21,
    lifecycle: "ACTIVE",
    status: "启用",
    updatedAt: "2026-07-21T08:00:00.000Z",
  },
  {
    // 与本地库有差异的一条:用于演示冲突队列
    externalId: "M-0003",
    internalPn: "QC-IC-0077",
    mpn: "MAX232CPE",
    manufacturer: "Texas Instruments",
    description: "RS-232 收发器 DIP-16(ERP 侧制造商与本地不一致)",
    footprint: "DIP-16",
    unit: "PCS",
    moq: 50,
    spq: 50,
    leadTimeDays: 45,
    lifecycle: "EOL",
    status: "停用",
    updatedAt: "2026-07-22T08:00:00.000Z",
  },
];

function page<T>(items: T[]): ErpPage<T> {
  return { items, page: { cursor: null, hasMore: false, total: items.length } };
}

export class MockErpProvider implements ErpProvider {
  readonly vendor = "MOCK";

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      ok: true,
      responseMs: 12,
      erpVersion: "Mock 1.0",
      organization: "示例账套",
      capabilities: [
        "pullMaterials",
        "pushMaterials",
        "pullInventory",
        "pullOpenPurchaseOrders",
        "pullWorkOrders",
        "pushPurchaseOrders",
        "pushEtaUpdates",
      ],
      failureReason: null,
      suggestion: "这是 Mock Provider —— 连接成功不代表任何真实 ERP 已接通",
      testedAt: new Date().toISOString(),
    };
  }

  async getMetadata(): Promise<ErpMetadata> {
    return {
      vendor: "MOCK",
      edition: "1.0",
      entityFields: {
        MATERIAL: ["FNumber", "FName", "FSpecification", "FMnemonicCode", "FMoq", "FSpq", "FLeadTime"],
        INVENTORY: ["FStockId", "FStockLocId", "FLot", "FQty", "FLockQty"],
        OPEN_PO: ["FBillNo", "FSeq", "FSupplierId", "FQty", "FReceiveQty", "FDeliveryDate"],
        WORK_ORDER: ["FBillNo", "FMaterialId", "FBomId", "FQty", "FPlanStartDate"],
      },
      capabilities: [
        "pullMaterials",
        "pushMaterials",
        "pullInventory",
        "pullOpenPurchaseOrders",
        "pullWorkOrders",
        "pushPurchaseOrders",
        "pushEtaUpdates",
      ],
      notImplemented: [],
    };
  }

  async pullMaterials(): Promise<ErpPage<ErpMaterial>> {
    return page(MATERIALS);
  }

  async pushMaterials(): Promise<ErpPushResult> {
    return {
      accepted: 0,
      rejected: 0,
      externalJobId: "MOCK-JOB-1",
      failures: [],
      writtenToErp: false,
      note: "Mock 不真的写入任何 ERP",
    };
  }

  async pullInventory(): Promise<ErpPage<ErpInventory>> {
    return page([
      {
        warehouse: "成品仓",
        location: "A-01-02",
        internalPn: "QC-IC-0001",
        lotNo: "LOT-2026-07-01",
        qty: "854",
        lockedQty: "0",
        availableQty: "854",
        dateCode: "2625",
        receivedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
  }

  async pullOpenPurchaseOrders(): Promise<ErpPage<ErpOpenPo>> {
    return page([
      {
        poNo: "PO-2026-001",
        lineNo: 1,
        supplier: "华强北电子(示例)",
        internalPn: "QC-IC-0001",
        mpn: "STM32F103C8T6",
        qtyOrdered: "1000",
        qtyReceived: "0",
        qtyOpen: "1000",
        eta: "2026-08-20T00:00:00.000Z",
        currency: "CNY",
        unitPrice: "7.10",
      },
    ]);
  }

  async pullWorkOrders(): Promise<ErpPage<ErpWorkOrder>> {
    return page([
      {
        workOrderNo: "WO-26-0412",
        product: "主控板 V2",
        bomVersion: "V3",
        plannedQty: "200",
        startAt: "2026-08-01T00:00:00.000Z",
        needDate: "2026-08-15T00:00:00.000Z",
        status: "已完工",
      },
    ]);
  }

  async pushPurchaseOrders(): Promise<ErpPushResult> {
    return {
      accepted: 0,
      rejected: 0,
      externalJobId: "MOCK-JOB-2",
      failures: [],
      writtenToErp: false,
      note: "Mock 不真的写入任何 ERP",
    };
  }

  async pushEtaUpdates(): Promise<ErpPushResult> {
    return {
      accepted: 0,
      rejected: 0,
      externalJobId: "MOCK-JOB-3",
      failures: [],
      writtenToErp: false,
      note: "Mock 不真的写入任何 ERP",
    };
  }

  async getJobStatus(_c: ErpConnectionConfig, externalJobId: string): Promise<ErpJobStatus> {
    return { externalJobId, state: "SUCCEEDED", message: "Mock 作业" };
  }
}
