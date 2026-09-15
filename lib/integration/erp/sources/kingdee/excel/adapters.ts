/**
 * R4-1:金蝶 Excel → Canonical DTO 的 7 个角色适配器。
 *
 * 纪律:
 * - 列名只经 Profile(qianchuang-k3-v1)取,业务字段名不出现在此文件之外;
 * - blank→null,非法值→行 issue,MFG_PN 为空在 PO 合法(§22);
 * - 行级 issue 不 throw —— 收集到 record.issues,STRICT/LENIENT 语义由上层定;
 * - 任何 message 不携带整行数据(§4)。
 */
import type {
  AdapterResult,
  CanonicalCustomer,
  CanonicalExcess,
  CanonicalInventory,
  CanonicalMaterial,
  CanonicalMaterialMfg,
  CanonicalPurchaseOrderLine,
  CanonicalRecord,
  CanonicalSupplier,
  SourceRowIssue,
} from "../../../canonical/types";
import {
  classifyMaterialKind,
  identifierKindFor,
  identifierMatchModeOf,
} from "../../../normalization/material-kind";
import {
  normalizeBoolean,
  normalizeDate,
  normalizeDecimal,
  normalizeJunkText,
  normalizeText,
  requireText,
} from "../../../normalization/values";
import {
  QIANCHUANG_K3_V1,
  missingRequiredColumns,
  pick,
  type FileRole,
  type SourceProfile,
} from "../../../profiles/qianchuang-k3-v1";
import type { ParsedSheet } from "./workbook";

interface Ctx {
  profile: SourceProfile;
  role: FileRole;
  sheet: ParsedSheet;
  sourceFile: string;
}

function makeRunner(ctx: Ctx) {
  const cols = ctx.profile.columns[ctx.role];
  return {
    get(row: { cells: Record<string, string> }, field: string): string | undefined {
      const aliases = cols[field];
      if (!aliases) return undefined;
      return pick(row.cells, ctx.sheet.headers, aliases);
    },
  };
}

function adapt<T extends CanonicalRecord>(
  ctx: Ctx,
  build: (
    get: (row: { cells: Record<string, string> }, field: string) => string | undefined,
    row: { sourceRow: number; cells: Record<string, string> },
    issues: SourceRowIssue[],
  ) => Omit<T, keyof CanonicalRecord> | null,
): AdapterResult<T> {
  const fileIssues = missingRequiredColumns(ctx.profile, ctx.role, ctx.sheet.headers).map(
    (c) => `缺少必需列「${c}」`,
  );
  const records: T[] = [];
  let rowsWithIssues = 0;
  if (fileIssues.length === 0) {
    const { get } = makeRunner(ctx);
    for (const row of ctx.sheet.rows) {
      const issues: SourceRowIssue[] = [];
      const core = build(get, row, issues);
      if (core === null) continue; // 整行空等,build 决定跳过
      if (issues.length > 0) rowsWithIssues++;
      records.push({
        ...(core as T),
        sourceFile: ctx.sourceFile,
        sourceSheet: ctx.sheet.sheetName,
        sourceRow: row.sourceRow,
        issues,
      });
    }
  }
  return {
    records,
    fileIssues,
    meta: {
      sourceFile: ctx.sourceFile,
      sheetName: ctx.sheet.sheetName,
      headerRowIndex: ctx.sheet.headerRowIndex,
      headers: ctx.sheet.headers,
      duplicateHeaders: ctx.sheet.duplicateHeaders,
      totalRows: ctx.sheet.rows.length,
      rowsWithIssues,
    },
  };
}

const P = QIANCHUANG_K3_V1;

export function adaptMaterial(sheet: ParsedSheet, sourceFile: string): AdapterResult<CanonicalMaterial> {
  return adapt<CanonicalMaterial>({ profile: P, role: "MATERIAL", sheet, sourceFile }, (get, row, issues) => {
    const internalPn = requireText(get(row, "internalPn"), "internalPn", issues);
    if (internalPn === null && Object.values(row.cells).every((v) => v === "")) return null;
    const rawMaterialType = normalizeText(get(row, "rawMaterialType"));
    const name = normalizeText(get(row, "name"));
    const kind = classifyMaterialKind({ rawMaterialType, materialName: name });
    return {
      internalPn: internalPn ?? "",
      name,
      specification: normalizeText(get(row, "specification")),
      customerPnUnscoped: normalizeJunkText(get(row, "customerPnUnscoped")),
      alias: normalizeText(get(row, "alias")),
      unit: normalizeText(get(row, "unit")),
      rawMaterialType,
      materialKind: kind.materialKind,
      materialKindSource: kind.source,
      materialKindConfidence: kind.confidence,
      sourcingAttr: normalizeText(get(row, "sourcingAttr")),
      msl: normalizeText(get(row, "msl")),
      dataStatus: normalizeText(get(row, "dataStatus")),
      disabled: normalizeBoolean(get(row, "disabled")),
      erpCreatedAt: normalizeDate(get(row, "erpCreatedAt"), "erpCreatedAt", issues),
      batchManaged: normalizeBoolean(get(row, "batchManaged")),
    };
  });
}

export function adaptMaterialMfg(
  sheet: ParsedSheet,
  sourceFile: string,
  /** 由 Material 主数据提供的 internalPn → MaterialKind(分类一级证据);缺省按名称推 */
  kindByInternalPn?: Map<string, ReturnType<typeof classifyMaterialKind>>,
): AdapterResult<CanonicalMaterialMfg> {
  return adapt<CanonicalMaterialMfg>(
    { profile: P, role: "MATERIAL_MFG", sheet, sourceFile },
    (get, row, issues) => {
      const internalPn = requireText(get(row, "internalPn"), "internalPn", issues) ?? "";
      const rawManufacturerPartNo = requireText(get(row, "rawManufacturerPartNo"), "rawManufacturerPartNo", issues) ?? "";
      const materialName = normalizeText(get(row, "materialName"));
      const kind =
        kindByInternalPn?.get(internalPn.toUpperCase()) ??
        classifyMaterialKind({ rawMaterialType: null, materialName });
      return {
        internalPn,
        materialName,
        specification: normalizeText(get(row, "specification")),
        rawManufacturer: normalizeJunkText(get(row, "rawManufacturer")),
        rawManufacturerPartNo,
        identifierKind: identifierKindFor(kind.materialKind),
        identifierKindSource: kind.source,
        identifierMatchMode: identifierMatchModeOf(rawManufacturerPartNo),
        sourceDocumentNo: normalizeText(get(row, "sourceDocumentNo")),
        sourceLineId: normalizeText(get(row, "sourceLineId")),
        sourceCreatedAt: normalizeDate(get(row, "sourceCreatedAt"), "sourceCreatedAt", issues),
      };
    },
  );
}

export function adaptInventory(sheet: ParsedSheet, sourceFile: string): AdapterResult<CanonicalInventory> {
  return adapt<CanonicalInventory>({ profile: P, role: "INVENTORY", sheet, sourceFile }, (get, row, issues) => {
    const rawOwnerType = normalizeText(get(row, "ownerType"));
    // 货主类型:客户/业务组织;未知写法如实 UNKNOWN(不猜,§33)
    const ownerType =
      rawOwnerType === "客户" ? "CUSTOMER" : rawOwnerType === "业务组织" ? "ORGANIZATION" : "UNKNOWN";
    if (ownerType === "UNKNOWN" && rawOwnerType) {
      issues.push({ code: "UNKNOWN_ENUM", field: "ownerType", message: `未知货主类型「${rawOwnerType}」` });
    }
    return {
      internalPn: requireText(get(row, "internalPn"), "internalPn", issues) ?? "",
      materialName: normalizeText(get(row, "materialName")),
      warehouseName: normalizeText(get(row, "warehouseName")),
      lotNo: normalizeText(get(row, "lotNo")),
      unit: normalizeText(get(row, "unit")),
      onHandQty: normalizeDecimal(get(row, "onHandQty"), "onHandQty", issues) ?? "0",
      // 源数据只有库存量 —— available/reserved 未知,不假装(§33)
      availableQty: null,
      reservedQty: null,
      customerPnUnscoped: normalizeJunkText(get(row, "customerPnUnscoped")),
      ownerType,
      ownerNameRaw: normalizeText(get(row, "ownerNameRaw")),
    };
  });
}

export function adaptExcess(sheet: ParsedSheet, sourceFile: string): AdapterResult<CanonicalExcess> {
  return adapt<CanonicalExcess>({ profile: P, role: "EXCESS", sheet, sourceFile }, (get, row, issues) => {
    const dec = (f: string) => normalizeDecimal(get(row, f), f, issues);
    return {
      internalPn: requireText(get(row, "internalPn"), "internalPn", issues) ?? "",
      customerNameRaw: normalizeText(get(row, "customerNameRaw")),
      customerPnRaw: normalizeJunkText(get(row, "customerPnRaw")),
      description: normalizeText(get(row, "description")),
      // 最后业务发生时间 ≠ 最早入库时间(§34):源无后者 → null
      lastBusinessAt: normalizeDate(get(row, "lastBusinessAt"), "lastBusinessAt", issues),
      earliestInboundAt: null,
      onHandQty: dec("onHandQty"),
      overIssueQty: dec("overIssueQty"),
      demandQty: dec("demandQty"),
      receivedNotStockedQty: dec("receivedNotStockedQty"),
      excessQtyExclOpo: dec("excessQtyExclOpo"),
      openPoNotReceivedQty: dec("openPoNotReceivedQty"),
      excessQtyInclOpo: dec("excessQtyInclOpo"),
      moq: dec("moq"),
      standardUnitPrice: dec("standardUnitPrice"),
      excessAmountExclOpo: dec("excessAmountExclOpo"),
      excessAmountInclOpo: dec("excessAmountInclOpo"),
      relatedModels: normalizeText(get(row, "relatedModels")),
      kanbanQty: dec("kanbanQty"),
      kanbanAmount: dec("kanbanAmount"),
    };
  });
}

export function adaptCustomer(sheet: ParsedSheet, sourceFile: string): AdapterResult<CanonicalCustomer> {
  return adapt<CanonicalCustomer>({ profile: P, role: "CUSTOMER", sheet, sourceFile }, (get, row, issues) => ({
    customerCode: requireText(get(row, "customerCode"), "customerCode", issues) ?? "",
    name: requireText(get(row, "name"), "name", issues) ?? "",
    shortName: normalizeText(get(row, "shortName")),
    status: normalizeText(get(row, "dataStatus")),
    disabled: normalizeBoolean(get(row, "disabled")),
    group: normalizeText(get(row, "group")),
  }));
}

export function adaptSupplier(sheet: ParsedSheet, sourceFile: string): AdapterResult<CanonicalSupplier> {
  return adapt<CanonicalSupplier>({ profile: P, role: "SUPPLIER", sheet, sourceFile }, (get, row, issues) => ({
    supplierCode: requireText(get(row, "supplierCode"), "supplierCode", issues) ?? "",
    name: requireText(get(row, "name"), "name", issues) ?? "",
    shortName: normalizeText(get(row, "shortName")),
    group: normalizeText(get(row, "group")),
    status: normalizeText(get(row, "dataStatus")),
    disabled: normalizeBoolean(get(row, "disabled")),
    grade: normalizeText(get(row, "grade")),
    erpCreatedAt: normalizeDate(get(row, "erpCreatedAt"), "erpCreatedAt", issues),
  }));
}

export function adaptPurchaseOrder(
  sheet: ParsedSheet,
  sourceFile: string,
): AdapterResult<CanonicalPurchaseOrderLine> {
  // 同一 ERP 单据内的稳定行序:按源行号出现顺序编号(§49:源无 ERP 行号)
  const lineCounters = new Map<string, number>();
  return adapt<CanonicalPurchaseOrderLine>(
    { profile: P, role: "PURCHASE_ORDER", sheet, sourceFile },
    (get, row, issues) => {
      const erpPoNumber = requireText(get(row, "erpPoNumber"), "erpPoNumber", issues) ?? "";
      const n = (lineCounters.get(erpPoNumber) ?? 0) + 1;
      lineCounters.set(erpPoNumber, n);
      const dec = (f: string) => normalizeDecimal(get(row, f), f, issues);
      return {
        erpPoNumber,
        sourceLineNo: n,
        internalPn: requireText(get(row, "internalPn"), "internalPn", issues) ?? "",
        materialName: normalizeText(get(row, "materialName")),
        // MFG/MFG_PN 空为合法(§22)—— 只作历史证据
        rawManufacturer: normalizeJunkText(get(row, "rawManufacturer")),
        rawManufacturerPartNo: normalizeJunkText(get(row, "rawManufacturerPartNo")),
        supplierNameRaw: normalizeText(get(row, "supplierNameRaw")),
        orderDate: normalizeDate(get(row, "orderDate"), "orderDate", issues),
        requestedDeliveryDate: normalizeDate(get(row, "requestedDeliveryDate"), "requestedDeliveryDate", issues),
        qty: dec("qty"),
        unit: normalizeText(get(row, "unit")),
        unitPrice: dec("unitPrice"),
        receivedQty: dec("receivedQty"),
        materialReceivedQty: dec("materialReceivedQty"),
        remainingQty: dec("remainingQty"),
        docStatus: normalizeText(get(row, "docStatus")),
        closeStatus: normalizeText(get(row, "closeStatus")),
        businessClosed: normalizeText(get(row, "businessClosed")),
        isGift: normalizeBoolean(get(row, "isGift")),
        remark1: normalizeText(get(row, "remark1")),
        remark2: normalizeText(get(row, "remark2")),
      };
    },
  );
}
