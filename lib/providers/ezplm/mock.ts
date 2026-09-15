/**
 * MockEzplmProvider:无真实文档与 Key 时的开发实现(SPEC §7)。
 * 固定样例数据,行为确定;合同测试与 Http 实现共用同一断言集。
 * ⚠ 诚实纪律:本实现是 Mock,不代表已与 ezPLM 联调。
 */
import type { EzplmPartsProvider } from "./provider";
import {
  SearchPartsInputSchema,
  type AlternatePart,
  type BatchResolveInput,
  type BatchResolveResult,
  type CanonicalPart,
  type ComplianceResult,
  type CustomerPartMappingDto,
  type GetPartByMpnInput,
  type InventoryResult,
  type PartDocument,
  type PartParameter,
  type SearchPartsInput,
} from "./types";

const T0 = "2026-07-20T08:00:00.000Z"; // 固定样例时间戳(数据更新时间展示用)

/** 样例物料(覆盖:活跃/EOL/NRND、无 MPN 辅料、合规缺失等形态) */
export const MOCK_PARTS: CanonicalPart[] = [
  {
    id: "ezp-1001",
    internalPn: "QC-IC-0001",
    mpn: "STM32F103C8T6",
    manufacturer: "STMicroelectronics",
    manufacturerId: "mock-mfr-stmicroelectronics",
    description: "MCU ARM Cortex-M3 64KB Flash LQFP-48",
    category: "微控制器(MCU)",
    footprint: "LQFP-48",
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    msl: "MSL3",
    packaging: "Tray",
    dateCode: "2523",
    updatedAt: T0,
  },
  {
    id: "ezp-1002",
    internalPn: "QC-RC-0104",
    mpn: "GRM188R71H104KA93D",
    manufacturer: "Murata",
    manufacturerId: "mock-mfr-murata",
    description: "CAP CER 0.1uF 50V X7R 0603",
    category: "电容",
    footprint: "0603",
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    msl: "MSL1",
    packaging: "T&R",
    dateCode: "2601",
    updatedAt: T0,
  },
  {
    id: "ezp-1003",
    internalPn: "QC-IC-0077",
    mpn: "MAX232CPE",
    manufacturer: "Analog Devices",
    manufacturerId: "mock-mfr-analog-devices",
    description: "RS-232 收发器 DIP-16(已停产)",
    category: "接口 IC",
    footprint: "DIP-16",
    lifecycle: "EOL",
    rohs: false,
    reach: null,
    msl: null,
    packaging: "Tube",
    dateCode: "2140",
    updatedAt: T0,
  },
  {
    id: "ezp-1004",
    internalPn: "QC-IC-0078",
    mpn: "MAX3232EIDR",
    manufacturer: "Texas Instruments",
    manufacturerId: "mock-mfr-texas-instruments",
    description: "RS-232 收发器 3-5.5V SOIC-16(MAX232 替代)",
    category: "电阻",
    footprint: "SOIC-16",
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    msl: "MSL2",
    packaging: "T&R",
    dateCode: "2602",
    updatedAt: T0,
  },
  {
    id: "ezp-1005",
    internalPn: "QC-RJ-0009",
    mpn: "RC0603FR-0710KL",
    manufacturer: "Yageo",
    manufacturerId: "mock-mfr-yageo",
    description: "RES 10K 1% 0603",
    category: "电源管理",
    footprint: "0603",
    lifecycle: "NRND",
    rohs: true,
    reach: true,
    msl: "MSL1",
    packaging: "T&R",
    dateCode: "2551",
    updatedAt: T0,
  },
  {
    id: "ezp-1006",
    internalPn: "QC-AUX-0002",
    mpn: null,
    manufacturer: null,
    manufacturerId: null,
    description: "锡膏 SAC305 500g(辅料,无 MPN)",
    category: "结构件",
    footprint: null,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: null,
    msl: null,
    packaging: "Jar",
    dateCode: null,
    updatedAt: T0,
  },
];

const MOCK_INVENTORY: Record<string, Omit<InventoryResult, "partId">> = {
  "ezp-1001": { qtyOnHand: 1200, qtySlowMoving: 0, warehouse: "SZ-A1", updatedAt: T0 },
  "ezp-1002": { qtyOnHand: 85000, qtySlowMoving: 12000, warehouse: "SZ-A1", updatedAt: T0 },
  "ezp-1003": { qtyOnHand: 40, qtySlowMoving: 40, warehouse: "SZ-B2", updatedAt: T0 },
  "ezp-1004": { qtyOnHand: 0, qtySlowMoving: 0, warehouse: null, updatedAt: T0 },
  "ezp-1005": { qtyOnHand: 30000, qtySlowMoving: 30000, warehouse: "SZ-B2", updatedAt: T0 },
};

const MOCK_MAPPINGS: Record<string, CustomerPartMappingDto[]> = {
  // 样例客户:联创科技(示例数据中的下游客户)
  "cus-lianchuang": [
    {
      customerId: "cus-lianchuang",
      customerPn: "LC-M-3201",
      internalPn: "QC-IC-0001",
      mpn: "STM32F103C8T6",
      manufacturer: "STMicroelectronics",
    },
    {
      customerId: "cus-lianchuang",
      customerPn: "LC-C-0088",
      internalPn: "QC-RC-0104",
      mpn: "GRM188R71H104KA93D",
      manufacturer: "Murata",
    },
  ],
};

const MOCK_ALTERNATES: Record<string, { altId: string; grade: string; note: string | null }[]> = {
  "ezp-1003": [{ altId: "ezp-1004", grade: "完全替代", note: "3.3V/5V 兼容,封装不同需确认" }],
  "ezp-1002": [],
};

/** 规格参数样例(对齐静态原型「规格参数」页签) */
const MOCK_PARAMETERS: Record<string, PartParameter[]> = {
  "ezp-1001": [
    { name: "内核", value: "ARM Cortex-M3", unit: null, group: "核心" },
    { name: "主频", value: "72", unit: "MHz", group: "核心" },
    { name: "Flash", value: "64", unit: "KB", group: "存储" },
    { name: "SRAM", value: "20", unit: "KB", group: "存储" },
    { name: "工作电压", value: "2.0 ~ 3.6", unit: "V", group: "电气特性" },
    { name: "工作温度", value: "-40 ~ 85", unit: "℃", group: "环境" },
    { name: "封装", value: "LQFP-48", unit: null, group: "封装" },
    { name: "引脚数", value: "48", unit: null, group: "封装" },
  ],
  "ezp-1002": [
    { name: "容值", value: "0.1", unit: "uF", group: "电气特性" },
    { name: "耐压", value: "50", unit: "V", group: "电气特性" },
    { name: "介质", value: "X7R", unit: null, group: "电气特性" },
    { name: "精度", value: "±10", unit: "%", group: "电气特性" },
    { name: "工作温度", value: "-55 ~ 125", unit: "℃", group: "环境" },
    { name: "封装", value: "0603", unit: null, group: "封装" },
  ],
  "ezp-1003": [
    { name: "通道数", value: "2 驱动 / 2 接收", unit: null, group: "核心" },
    { name: "工作电压", value: "5", unit: "V", group: "电气特性" },
    { name: "数据速率", value: "120", unit: "kbps", group: "电气特性" },
    { name: "封装", value: "DIP-16", unit: null, group: "封装" },
  ],
  "ezp-1004": [
    { name: "通道数", value: "2 驱动 / 2 接收", unit: null, group: "核心" },
    { name: "工作电压", value: "3.0 ~ 5.5", unit: "V", group: "电气特性" },
    { name: "数据速率", value: "250", unit: "kbps", group: "电气特性" },
    { name: "封装", value: "SOIC-16", unit: null, group: "封装" },
  ],
  "ezp-1005": [
    { name: "阻值", value: "10", unit: "kΩ", group: "电气特性" },
    { name: "精度", value: "±1", unit: "%", group: "电气特性" },
    { name: "功率", value: "0.1", unit: "W", group: "电气特性" },
    { name: "封装", value: "0603", unit: null, group: "封装" },
  ],
};

/** 工程文档样例(数据手册 + 库文件,对齐静态原型「文档」页签) */
const MOCK_DOCUMENTS: Record<string, PartDocument[]> = {
  "ezp-1001": [
    { id: "d-1001-ds", kind: "DATASHEET", name: "STM32F103xx Datasheet Rev.17.pdf", url: "https://example.invalid/ezplm/docs/stm32f103-ds.pdf", version: "Rev.17", sizeBytes: 2_411_520, updatedAt: T0 },
    { id: "d-1001-sym", kind: "SYMBOL", name: "STM32F103C8T6.SchLib", url: "https://example.invalid/ezplm/lib/stm32f103c8t6.schlib", version: "v3", sizeBytes: 48_128, updatedAt: T0 },
    { id: "d-1001-fp", kind: "FOOTPRINT", name: "LQFP-48_7x7mm.PcbLib", url: "https://example.invalid/ezplm/lib/lqfp48.pcblib", version: "v3", sizeBytes: 96_256, updatedAt: T0 },
    { id: "d-1001-3d", kind: "MODEL_3D", name: "LQFP-48.step", url: "https://example.invalid/ezplm/lib/lqfp48.step", version: "v1", sizeBytes: 512_000, updatedAt: T0 },
  ],
  "ezp-1002": [
    { id: "d-1002-ds", kind: "DATASHEET", name: "GRM188R71H104KA93D Datasheet.pdf", url: "https://example.invalid/ezplm/docs/grm188.pdf", version: "Rev.C", sizeBytes: 620_000, updatedAt: T0 },
    { id: "d-1002-fp", kind: "FOOTPRINT", name: "C0603.PcbLib", url: "https://example.invalid/ezplm/lib/c0603.pcblib", version: "v2", sizeBytes: 24_576, updatedAt: T0 },
  ],
  "ezp-1003": [
    { id: "d-1003-ds", kind: "DATASHEET", name: "MAX232 Datasheet.pdf", url: "https://example.invalid/ezplm/docs/max232.pdf", version: "Rev.G", sizeBytes: 780_000, updatedAt: T0 },
    { id: "d-1003-eol", kind: "CERTIFICATE", name: "停产通知 PCN-2024-118.pdf", url: "https://example.invalid/ezplm/docs/pcn-2024-118.pdf", version: null, sizeBytes: 120_000, updatedAt: T0 },
  ],
  "ezp-1004": [
    { id: "d-1004-ds", kind: "DATASHEET", name: "MAX3232E Datasheet.pdf", url: "https://example.invalid/ezplm/docs/max3232e.pdf", version: "Rev.J", sizeBytes: 810_000, updatedAt: T0 },
    { id: "d-1004-sym", kind: "SYMBOL", name: "MAX3232EIDR.SchLib", url: "https://example.invalid/ezplm/lib/max3232eidr.schlib", version: "v2", sizeBytes: 36_864, updatedAt: T0 },
  ],
};

function norm(s: string): string {
  return s.trim().toUpperCase();
}

export class MockEzplmProvider implements EzplmPartsProvider {
  async searchParts(input: SearchPartsInput): Promise<CanonicalPart[]> {
    const { keyword, limit } = SearchPartsInputSchema.parse(input);
    const kw = norm(keyword);
    return MOCK_PARTS.filter((p) =>
      [p.mpn, p.internalPn, p.manufacturer, p.description]
        .filter((v): v is string => !!v)
        .some((v) => norm(v).includes(kw)),
    ).slice(0, limit);
  }

  async getPartByMpn(input: GetPartByMpnInput): Promise<CanonicalPart | null> {
    const mpn = norm(input.mpn);
    const hit = MOCK_PARTS.find(
      (p) =>
        p.mpn &&
        norm(p.mpn) === mpn &&
        (!input.manufacturer || norm(p.manufacturer ?? "") === norm(input.manufacturer)),
    );
    return hit ?? null;
  }

  async batchResolve(inputs: BatchResolveInput[]): Promise<BatchResolveResult[]> {
    return Promise.all(
      inputs.map(async (query) => {
        // 匹配顺序与 SPEC §6 一致:客户料号 → 内部料号 → 精确 MPN
        if (query.customerPn) {
          const m = Object.values(MOCK_MAPPINGS)
            .flat()
            .find((x) => norm(x.customerPn) === norm(query.customerPn!));
          if (m?.internalPn) {
            const part = MOCK_PARTS.find((p) => p.internalPn === m.internalPn) ?? null;
            if (part) return { query, part, confidence: 0.98 };
          }
        }
        if (query.internalPn) {
          const part = MOCK_PARTS.find(
            (p) => p.internalPn && norm(p.internalPn) === norm(query.internalPn!),
          );
          if (part) return { query, part, confidence: 0.97 };
        }
        if (query.mpn) {
          const part = await this.getPartByMpn({ mpn: query.mpn, manufacturer: query.manufacturer });
          if (part) return { query, part, confidence: query.manufacturer ? 0.95 : 0.9 };
        }
        return { query, part: null, confidence: 0 };
      }),
    );
  }

  async getInventory(partIds: string[]): Promise<InventoryResult[]> {
    return partIds
      .filter((id) => MOCK_INVENTORY[id])
      .map((id) => ({ partId: id, ...MOCK_INVENTORY[id] }));
  }

  async getCustomerMappings(customerId: string): Promise<CustomerPartMappingDto[]> {
    return MOCK_MAPPINGS[customerId] ?? [];
  }

  async getAlternates(partId: string): Promise<AlternatePart[]> {
    const rows = MOCK_ALTERNATES[partId] ?? [];
    return rows.flatMap((r) => {
      const alternate = MOCK_PARTS.find((p) => p.id === r.altId);
      return alternate ? [{ partId, alternate, grade: r.grade, note: r.note }] : [];
    });
  }

  async searchPartsWithParameters(
    input: SearchPartsInput,
  ): Promise<{ part: CanonicalPart; parameters: PartParameter[] }[]> {
    const parts = await this.searchParts(input);
    return parts.map((part) => ({ part, parameters: MOCK_PARAMETERS[part.id] ?? [] }));
  }

  async getParameters(partId: string): Promise<PartParameter[]> {
    return MOCK_PARAMETERS[partId] ?? [];
  }

  async getDocuments(partId: string): Promise<PartDocument[]> {
    return MOCK_DOCUMENTS[partId] ?? [];
  }

  async getCompliance(partId: string): Promise<ComplianceResult> {
    const part = MOCK_PARTS.find((p) => p.id === partId);
    return {
      partId,
      rohs: part?.rohs ?? null,
      reach: part?.reach ?? null,
      notes: part ? null : "样例库中不存在该物料",
      updatedAt: T0,
    };
  }
}
