/**
 * 追溯数据的三张标准导入模板。
 *
 * 本系统**没有 MES**,批次数据只能靠导入或 ERP 同步 —— 这三张表就是数据入口:
 * ① 收料批次:PO / 供应商批次 → 内部批次
 * ② 工单用料:内部批次 → 工单(**全链路最关键的一跳**,缺了整条链就断)
 * ③ 出货关系:成品批次 → 工单 / 客户 / 出货单
 *
 * 纪律:
 * - 行级校验、行级报错(带行号),**不静默丢弃**;
 * - 关键字段缺失就是缺失,不猜、不填默认值;
 * - 数量必须是有效数值且 > 0 —— 0 数量的收料/发料行没有业务含义;
 * - 同一文件重复导入靠幂等键防重(键在数据层算)。
 */
import {
  cellText,
  detectVocabularyMapping,
  missingFields,
  type ColumnVocabulary,
  type MappingResult,
} from "@/modules/tabular/domain/column-mapping";
import {
  TRACE_RECEIPT_VOCABULARY,
  TRACE_SHIPMENT_VOCABULARY,
  TRACE_WO_ISSUE_VOCABULARY,
} from "@/modules/tabular/vocabularies/trace";
import { detectDelimiter, parseCsv } from "./csv";

export type TraceTemplate = "RECEIPT" | "WO_ISSUE" | "SHIPMENT";

export const TEMPLATE_LABEL: Record<TraceTemplate, string> = {
  RECEIPT: "收料批次",
  WO_ISSUE: "工单用料",
  SHIPMENT: "出货关系",
};

/* ---------------- 字段定义 ---------------- */

export type ReceiptField =
  | "poNo" | "poLineNo" | "supplier" | "mpn" | "internalPn"
  | "supplierLot" | "internalLot" | "receivedQty" | "receivedAt"
  | "dateCode" | "warehouse" | "location";

export type WoIssueField =
  | "workOrderNo" | "product" | "bomVersion" | "lotNo" | "mpn"
  | "issuedQty" | "returnedQty" | "productionLine" | "issuedAt" | "operator";

export type ShipmentField =
  | "fgLotNo" | "workOrderNo" | "customer" | "customerPo"
  | "shipmentNo" | "shippedQty" | "shippedAt";

/** 三模板的列词表是数据:modules/tabular/vocabularies/trace.ts(含各模板必需列) */
const VOCABULARY: Record<TraceTemplate, ColumnVocabulary<string>> = {
  RECEIPT: TRACE_RECEIPT_VOCABULARY satisfies ColumnVocabulary<ReceiptField>,
  WO_ISSUE: TRACE_WO_ISSUE_VOCABULARY satisfies ColumnVocabulary<WoIssueField>,
  SHIPMENT: TRACE_SHIPMENT_VOCABULARY satisfies ColumnVocabulary<ShipmentField>,
};

const FIELD_LABEL: Record<string, string> = {
  poNo: "PO", poLineNo: "PO 行号", supplier: "供应商", mpn: "MPN", internalPn: "内部料号",
  supplierLot: "供应商批次", internalLot: "内部批次", receivedQty: "收料数量", receivedAt: "入库时间",
  dateCode: "DC", warehouse: "仓库", location: "库位",
  workOrderNo: "工单号", product: "产品", bomVersion: "BOM 版本", lotNo: "物料批次",
  issuedQty: "发料数量", returnedQty: "退料数量", productionLine: "产线", issuedAt: "发料时间", operator: "操作员",
  fgLotNo: "成品批次", customer: "客户", customerPo: "客户 PO", shipmentNo: "出货单号",
  shippedQty: "出货数量", shippedAt: "出货日期",
};

export interface TraceParseResult {
  template: TraceTemplate;
  mapping: MappingResult<string>;
  rows: Record<string, string | null>[];
  errors: { row: number; message: string }[];
  notices: string[];
}

function numOrNull(raw: string): string | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? t : null;
}

function isoOrNull(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

const EMPTY: MappingResult<string> = { fields: {}, headerRowIndex: -1, unmapped: [], confidence: 0 };

export function parseTraceTemplate(template: TraceTemplate, text: string): TraceParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { template, mapping: EMPTY, rows: [], errors: [{ row: 0, message: "没有输入内容" }], notices: [] };
  }

  const grid = parseCsv(trimmed, detectDelimiter(trimmed)).filter((r) => r.some((c) => c.trim() !== ""));
  if (grid.length === 0) {
    return { template, mapping: EMPTY, rows: [], errors: [{ row: 0, message: "未能解析出表格" }], notices: [] };
  }

  const mapping = detectVocabularyMapping(grid, VOCABULARY[template]);
  const errors: { row: number; message: string }[] = [];
  const notices: string[] = [];

  const missing = missingFields(mapping, VOCABULARY[template].required);
  if (missing.length > 0) {
    errors.push({
      row: mapping.headerRowIndex + 1,
      message: `缺少必需列:${missing.map((f) => FIELD_LABEL[f] ?? f).join("、")}`,
    });
    return { template, mapping, rows: [], errors, notices };
  }

  // 关键可选列缺失要提示,因为它们决定链路能否连起来
  if (template === "RECEIPT" && mapping.fields.poNo === undefined) {
    notices.push("未识别到「PO」列 —— 收料批次将无法回溯到采购订单与供应商");
  }
  if (template === "SHIPMENT" && mapping.fields.workOrderNo === undefined) {
    notices.push("未识别到「工单」列 —— 成品批次将无法回溯到生产工单");
  }

  const numericFields: Record<TraceTemplate, string> = {
    RECEIPT: "receivedQty",
    WO_ISSUE: "issuedQty",
    SHIPMENT: "shippedQty",
  };
  const qtyField = numericFields[template];

  const rows: Record<string, string | null>[] = [];
  for (let i = mapping.headerRowIndex + 1; i < grid.length; i += 1) {
    const row = grid[i];
    const get = (f: string): string => cellText(row, mapping.fields[f]) ?? "";

    const out: Record<string, string | null> = {};
    let rowEmpty = true;
    for (const f of Object.keys(VOCABULARY[template].aliases)) {
      const v = get(f).trim();
      if (v) rowEmpty = false;
      out[f] = v || null;
    }
    if (rowEmpty) continue;

    let bad = false;
    for (const f of VOCABULARY[template].required) {
      if (!out[f]) {
        errors.push({ row: i + 1, message: `缺少「${FIELD_LABEL[f] ?? f}」` });
        bad = true;
      }
    }
    if (bad) continue;

    const qty = numOrNull(out[qtyField] ?? "");
    if (qty === null) {
      errors.push({ row: i + 1, message: `「${FIELD_LABEL[qtyField]}」不是有效数值` });
      continue;
    }
    if (Number(qty) <= 0) {
      errors.push({ row: i + 1, message: `「${FIELD_LABEL[qtyField]}」为 0 或负数,该行没有业务含义` });
      continue;
    }
    out[qtyField] = qty;

    for (const dateField of ["receivedAt", "issuedAt", "shippedAt"]) {
      if (out[dateField] === undefined || out[dateField] === null) continue;
      const iso = isoOrNull(out[dateField]!);
      if (iso === null) {
        notices.push(`第 ${i + 1} 行的日期「${out[dateField]}」无法识别,该行时间按未知处理`);
      }
      out[dateField] = iso;
    }

    for (const intField of ["poLineNo"]) {
      if (!out[intField]) continue;
      const n = Number(out[intField]);
      out[intField] = Number.isFinite(n) ? String(Math.trunc(n)) : null;
    }

    rows.push(out);
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: mapping.headerRowIndex + 1, message: "表头之后没有数据行" });
  }
  return { template, mapping, rows, errors, notices };
}

/** 模板示例(UI 里给「下载模板」用) */
export const TEMPLATE_HEADERS: Record<TraceTemplate, string[]> = {
  RECEIPT: ["PO", "PO行号", "供应商", "MPN", "内部料号", "供应商批次", "内部批次", "收料数量", "入库时间", "DC", "仓库", "库位"],
  WO_ISSUE: ["工单号", "产品", "BOM版本", "物料批次", "MPN", "发料数量", "退料数量", "产线", "发料时间", "操作员"],
  SHIPMENT: ["成品批次", "工单号", "客户", "客户PO", "出货单号", "出货数量", "出货日期"],
};
