/**
 * R4-1:ERP Integration Agent —— Canonical DTO 层。
 *
 * 架构边界(R4 v2 §2/§37):业务层**只消费本文件的 Canonical 形状**,
 * 永不感知金蝶 Excel 表头或未来金蝶 API 字段名;
 * Kingdee Excel Adapter 与将来的 Kingdee API Adapter 都归一到这里。
 * ERP Lab 只是 HTTP 合约模拟器,不承担任何乾创字段解析(§56)。
 *
 * 数值纪律:金额/数量一律 **decimal 字符串**(禁止 JS float);
 * blank → null,非空非法 → row issue(INVALID_DECIMAL),绝不 blank→0。
 */

/** 行级问题(解析/校验期收集,决定 STRICT_UAT 下整包拒绝) */
export interface SourceRowIssue {
  code:
    | "INVALID_DECIMAL"
    | "INVALID_DATE"
    | "MISSING_REQUIRED"
    | "UNRESOLVED_REFERENCE"
    | "DUPLICATE_KEY"
    | "UNKNOWN_ENUM";
  /** 出错的 canonical 字段名 */
  field: string;
  /** 人话原因 —— **禁止**包含整行原始数据(§4 安全纪律),只引用出错单元格值 */
  message: string;
}

/** 每条 canonical 记录都带回源指针(证据链;sourceRow 是 Excel 物理行号) */
export interface SourceRef {
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
}

export interface CanonicalRecord extends SourceRef {
  issues: SourceRowIssue[];
}

// ---------------- Material ----------------

export type MaterialKind =
  | "ELECTRONIC_COMPONENT"
  | "PCB_BARE_BOARD"
  | "MECHANICAL"
  | "CABLE"
  | "ASSEMBLY"
  | "CONSUMABLE"
  | "OTHER";

export type MaterialKindSource = "ERP_MATERIAL_TYPE" | "ERP_MATERIAL_NAME" | "MFG_PN_PATTERN" | "MANUAL";

export interface CanonicalMaterial extends CanonicalRecord {
  internalPn: string;
  name: string | null;
  specification: string | null;
  /** 无 customerId 的客户料号 —— 只入 PartIdentifier(CUSTOMER_PN_UNSCOPED),永不自动进 CustomerPartMapping(§24) */
  customerPnUnscoped: string | null;
  alias: string | null;
  unit: string | null;
  /** ERP 原始「料号类型」值(证据保留) */
  rawMaterialType: string | null;
  materialKind: MaterialKind;
  materialKindSource: MaterialKindSource;
  materialKindConfidence: number;
  /** 物料属性(外购/自制/委外…原文保留) */
  sourcingAttr: string | null;
  msl: string | null;
  dataStatus: string | null;
  disabled: boolean | null;
  erpCreatedAt: string | null;
  batchManaged: boolean | null;
}

// ---------------- Material ↔ MFG Mapping ----------------

export type IdentifierKind =
  | "COMPONENT_MPN"
  | "PCB_PART_NO"
  | "MECHANICAL_PART_NO"
  | "ASSEMBLY_PART_NO"
  | "VENDOR_PART_NO"
  | "OTHER";

export type IdentifierMatchMode = "EXACT" | "PATTERN" | "UNKNOWN";

export interface CanonicalMaterialMfg extends CanonicalRecord {
  internalPn: string;
  materialName: string | null;
  specification: string | null;
  /** 原始 MFG 串,永久保留(canonical 解析属 ManufacturerResolver,R4-3) */
  rawManufacturer: string | null;
  rawManufacturerPartNo: string;
  identifierKind: IdentifierKind;
  identifierKindSource: MaterialKindSource;
  identifierMatchMode: IdentifierMatchMode;
  sourceDocumentNo: string | null;
  /** 源文件行内 ID 列(金蝶导出自带) */
  sourceLineId: string | null;
  sourceCreatedAt: string | null;
}

// ---------------- Inventory ----------------

export type InventoryOwnerType = "CUSTOMER" | "ORGANIZATION" | "UNKNOWN";

export interface CanonicalInventory extends CanonicalRecord {
  internalPn: string;
  materialName: string | null;
  warehouseName: string | null;
  lotNo: string | null;
  unit: string | null;
  /** 源数据只有「库存量」—— available/reserved 一律 null(未知语义,§33) */
  onHandQty: string;
  availableQty: null;
  reservedQty: null;
  customerPnUnscoped: string | null;
  ownerType: InventoryOwnerType;
  /** 原始货主名称(客户解析属 reconciliation 层,不在 adapter 猜) */
  ownerNameRaw: string | null;
}

// ---------------- Excess ----------------

export interface CanonicalExcess extends CanonicalRecord {
  internalPn: string;
  customerNameRaw: string | null;
  customerPnRaw: string | null;
  description: string | null;
  /** 最后业务发生时间 ≠ 最早入库时间(§34);源无 earliest inbound → null */
  lastBusinessAt: string | null;
  earliestInboundAt: null;
  onHandQty: string | null;
  overIssueQty: string | null;
  demandQty: string | null;
  receivedNotStockedQty: string | null;
  excessQtyExclOpo: string | null;
  openPoNotReceivedQty: string | null;
  excessQtyInclOpo: string | null;
  moq: string | null;
  standardUnitPrice: string | null;
  excessAmountExclOpo: string | null;
  excessAmountInclOpo: string | null;
  relatedModels: string | null;
  kanbanQty: string | null;
  kanbanAmount: string | null;
}

// ---------------- Customer / Supplier ----------------

export interface CanonicalCustomer extends CanonicalRecord {
  customerCode: string;
  name: string;
  shortName: string | null;
  status: string | null;
  disabled: boolean | null;
  group: string | null;
}

export interface CanonicalSupplier extends CanonicalRecord {
  supplierCode: string;
  name: string;
  shortName: string | null;
  group: string | null;
  status: string | null;
  disabled: boolean | null;
  grade: string | null;
  erpCreatedAt: string | null;
}

// ---------------- Purchase Order ----------------

export interface CanonicalPurchaseOrderLine extends CanonicalRecord {
  /** ERP 单据编号 = 正式业务身份(§49);DB cuid 只是内部 id */
  erpPoNumber: string;
  /** 源无 ERP 行号 → 同单据内稳定行序(按源行号推导),同时保留 sourceRow */
  sourceLineNo: number;
  internalPn: string;
  materialName: string | null;
  /** MFG/MFG_PN:PO 历史证据(§22)—— 空为合法 */
  rawManufacturer: string | null;
  rawManufacturerPartNo: string | null;
  supplierNameRaw: string | null;
  orderDate: string | null;
  /** ERP 交货日期 = Requested Delivery,与供应商 ETA / 收货日期三分离(§50) */
  requestedDeliveryDate: string | null;
  qty: string | null;
  unit: string | null;
  unitPrice: string | null;
  receivedQty: string | null;
  materialReceivedQty: string | null;
  remainingQty: string | null;
  docStatus: string | null;
  closeStatus: string | null;
  businessClosed: string | null;
  isGift: boolean | null;
  /** 双「备注」列各自保留(§38) */
  remark1: string | null;
  remark2: string | null;
}

// ---------------- 解析结果封套 ----------------

export interface AdapterResult<T extends CanonicalRecord> {
  records: T[];
  /** 解析层面(非行级)的问题,如表头缺列 */
  fileIssues: string[];
  meta: {
    sourceFile: string;
    sheetName: string;
    headerRowIndex: number;
    headers: string[];
    duplicateHeaders: string[];
    totalRows: number;
    rowsWithIssues: number;
  };
}
