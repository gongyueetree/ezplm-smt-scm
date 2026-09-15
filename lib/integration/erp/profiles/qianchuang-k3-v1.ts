/**
 * R4-1:乾创金蝶 K3 导出的 Source Mapping Profile(§36)。
 *
 * 业务代码禁止散落 row["MFG_PN"] —— 列名只在 Profile 出现一次;
 * 未来其它金蝶客户/字段名变化,新增 Profile 而不是改业务层。
 * 每个 canonical 字段给出**列名别名表**(实测:MFG 维护单用「物料代码」,
 * 其余文件用「物料编码」)。
 */

export type FileRole =
  | "MATERIAL"
  | "MATERIAL_MFG"
  | "INVENTORY"
  | "EXCESS"
  | "SUPPLIER"
  | "CUSTOMER"
  | "PURCHASE_ORDER";

export interface SourceProfile {
  id: string;
  description: string;
  /** 文件名 → 角色识别 */
  rolePatterns: [FileRole, RegExp][];
  /** 每角色:canonical 字段 → 源列名别名(按序取第一个存在的列) */
  columns: Record<FileRole, Record<string, string[]>>;
  /** 每角色用于识别的**必需列**(缺任一 → 文件级错误,拒绝解析) */
  requiredColumns: Record<FileRole, string[]>;
}

export const QIANCHUANG_K3_V1: SourceProfile = {
  id: "QIANCHUANG_K3_V1",
  description: "乾创电子 金蝶K3 标准导出(2026-09 实测样本)",
  rolePatterns: [
    ["MATERIAL_MFG", /MFG维护/],
    ["MATERIAL", /^物料_/],
    ["INVENTORY", /即时库存/],
    ["EXCESS", /EXCESS/i],
    ["SUPPLIER", /^供应商/],
    ["CUSTOMER", /^客户/],
    ["PURCHASE_ORDER", /采购订单/],
  ],
  columns: {
    MATERIAL: {
      internalPn: ["编码", "物料编码"],
      customerPnUnscoped: ["Customer PN"],
      msl: ["湿敏等级"],
      alias: ["别名"],
      name: ["名称", "物料名称"],
      specification: ["规格型号"],
      dataStatus: ["数据状态"],
      disabled: ["禁用状态"],
      erpCreatedAt: ["创建日期"],
      sourcingAttr: ["物料属性"],
      unit: ["基本单位"],
      batchManaged: ["启用批号管理"],
      rawMaterialType: ["料号类型"],
    },
    MATERIAL_MFG: {
      sourceDocumentNo: ["单据编号"],
      internalPn: ["物料代码", "物料编码"],
      materialName: ["物料名称"],
      specification: ["规格型号"],
      sourceLineId: ["ID"],
      rawManufacturer: ["MFG"],
      rawManufacturerPartNo: ["MFG_PN"],
      sourceCreatedAt: ["创建日期"],
    },
    INVENTORY: {
      internalPn: ["物料编码"],
      materialName: ["物料名称"],
      warehouseName: ["仓库名称"],
      lotNo: ["批号"],
      unit: ["库存主单位"],
      onHandQty: ["库存量(主单位)", "库存量"],
      customerPnUnscoped: ["Customer PN"],
      alias: ["别名"],
      ownerType: ["货主类型"],
      ownerNameRaw: ["货主名称"],
    },
    EXCESS: {
      customerNameRaw: ["客户"],
      lastBusinessAt: ["最后业务发生时间"],
      internalPn: ["物料编码"],
      customerPnRaw: ["客户料号"],
      description: ["描述"],
      onHandQty: ["即时库存"],
      overIssueQty: ["溢发"],
      demandQty: ["需求量"],
      receivedNotStockedQty: ["已收料未入库"],
      excessQtyExclOpo: ["呆滞数量（不含OPO）", "呆滞数量(不含OPO)"],
      openPoNotReceivedQty: ["采购订单未入库"],
      excessQtyInclOpo: ["呆滞数量（含OPO）", "呆滞数量(含OPO)"],
      moq: ["采购最小订货量"],
      standardUnitPrice: ["标准单价"],
      excessAmountExclOpo: ["呆滞金额（不含OPO）", "呆滞金额(不含OPO)"],
      excessAmountInclOpo: ["呆滞金额（含OPO）", "呆滞金额(含OPO)"],
      relatedModels: ["涉及机种"],
      kanbanQty: ["看板数量"],
      kanbanAmount: ["看板金额"],
    },
    SUPPLIER: {
      supplierCode: ["编码", "供应商编码"],
      name: ["名称", "供应商名称"],
      shortName: ["简称"],
      group: ["供应商分组"],
      dataStatus: ["数据状态"],
      disabled: ["禁用状态"],
      erpCreatedAt: ["创建日期"],
      grade: ["供应商等级"],
    },
    CUSTOMER: {
      customerCode: ["客户编码", "编码"],
      name: ["客户名称", "名称"],
      shortName: ["简称"],
      dataStatus: ["单据状态", "数据状态"],
      disabled: ["禁用状态"],
      group: ["客户分组"],
    },
    PURCHASE_ORDER: {
      erpPoNumber: ["单据编号"],
      remark1: ["备注"],
      remark2: ["备注#2"],
      rawManufacturerPartNo: ["MFG_PN"],
      rawManufacturer: ["MFG"],
      orderDate: ["采购日期"],
      supplierNameRaw: ["供应商"],
      docStatus: ["单据状态"],
      closeStatus: ["关闭状态"],
      internalPn: ["物料编码"],
      receivedQty: ["累计入库数量"],
      materialReceivedQty: ["累计收料数量"],
      materialName: ["物料名称"],
      remainingQty: ["剩余入库数量"],
      unit: ["采购单位"],
      qty: ["采购数量"],
      requestedDeliveryDate: ["交货日期"],
      isGift: ["是否赠品"],
      businessClosed: ["业务关闭"],
      unitPrice: ["单价"],
    },
  },
  requiredColumns: {
    MATERIAL: ["编码", "名称", "料号类型"],
    MATERIAL_MFG: ["MFG_PN", "MFG"],
    INVENTORY: ["物料编码", "货主类型"],
    EXCESS: ["物料编码", "最后业务发生时间"],
    SUPPLIER: ["名称"],
    CUSTOMER: ["客户名称"],
    PURCHASE_ORDER: ["单据编号", "物料编码", "MFG_PN"],
  },
};

/** 按 Profile 从行取值(别名表按序命中第一个存在的列) */
export function pick(
  cells: Record<string, string>,
  headers: string[],
  aliases: string[],
): string | undefined {
  for (const a of aliases) {
    if (headers.includes(a)) return cells[a];
  }
  return undefined;
}

export function detectRole(profile: SourceProfile, fileName: string): FileRole | null {
  for (const [role, re] of profile.rolePatterns) {
    if (re.test(fileName)) return role;
  }
  return null;
}

/** 必需列校验:缺列 → 文件级错误清单(拒绝进入行解析) */
export function missingRequiredColumns(
  profile: SourceProfile,
  role: FileRole,
  headers: string[],
): string[] {
  return profile.requiredColumns[role].filter((c) => !headers.includes(c));
}
