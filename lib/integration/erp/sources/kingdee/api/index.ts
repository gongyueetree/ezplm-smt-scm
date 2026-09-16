/**
 * R4-11(§37 v2):金蝶正式 API Adapter —— 骨架。
 *
 * 架构位(§2):
 *   Kingdee Excel Adapter(现役,乾创导出)┐
 *                                        ├→ Canonical DTO → 业务层
 *   Kingdee API Adapter(本骨架,待文档)  ┘
 *
 * 铁律:**没有正式金蝶 API 文档,禁止猜 endpoint/字段名**(§58)。
 * 每个方法在文档到位前一律抛 KingdeeApiNotDocumentedError
 * (WAITING_FOR_DOCUMENTATION)。业务层永不感知金蝶字段名 —— 文档
 * 到位后本层把 API 响应归一到 lib/integration/erp/canonical 的同一 DTO,
 * 与 Excel Adapter 汇合,业务代码零改动。
 */
import type {
  CanonicalCustomer,
  CanonicalExcess,
  CanonicalInventory,
  CanonicalMaterial,
  CanonicalMaterialMfg,
  CanonicalPurchaseOrderLine,
  CanonicalSupplier,
} from "../../../canonical/types";

export class KingdeeApiNotDocumentedError extends Error {
  readonly status = "WAITING_FOR_DOCUMENTATION" as const;
  constructor(operation: string) {
    super(
      `金蝶正式 API「${operation}」尚无接口文档(O1)—— 拒绝猜测 endpoint/鉴权/字段名。` +
        "文档到位后在本 Adapter 归一到 Canonical DTO,业务层零改动;当前请走金蝶 Excel 导出通道。",
    );
    this.name = "KingdeeApiNotDocumentedError";
  }
}

function notDocumented(operation: string): never {
  throw new KingdeeApiNotDocumentedError(operation);
}

export interface KingdeeApiConfig {
  /** 待文档确认:base url / 账套 / 鉴权方式全部未知,这里只留形状 */
  baseUrl?: string;
  credentialRef?: string;
}

/** 与 Excel Adapter 汇合于同一 Canonical DTO 的 API 侧接口(全部待文档) */
export const kingdeeApiAdapter = {
  status: "WAITING_FOR_DOCUMENTATION" as const,
  async pullMaterials(_c: KingdeeApiConfig): Promise<CanonicalMaterial[]> {
    return notDocumented("pullMaterials");
  },
  async pullMaterialMfgMappings(_c: KingdeeApiConfig): Promise<CanonicalMaterialMfg[]> {
    return notDocumented("pullMaterialMfgMappings");
  },
  async pullInventory(_c: KingdeeApiConfig): Promise<CanonicalInventory[]> {
    return notDocumented("pullInventory");
  },
  async pullExcess(_c: KingdeeApiConfig): Promise<CanonicalExcess[]> {
    return notDocumented("pullExcess");
  },
  async pullCustomers(_c: KingdeeApiConfig): Promise<CanonicalCustomer[]> {
    return notDocumented("pullCustomers");
  },
  async pullSuppliers(_c: KingdeeApiConfig): Promise<CanonicalSupplier[]> {
    return notDocumented("pullSuppliers");
  },
  async pullPurchaseOrders(_c: KingdeeApiConfig): Promise<CanonicalPurchaseOrderLine[]> {
    return notDocumented("pullPurchaseOrders");
  },
};
