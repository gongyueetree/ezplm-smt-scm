/**
 * 对账单解析:吃对方发来的表格(粘贴或从 xlsx 转出的文本)。
 *
 * 与 `po-bulk-input` 同一套做法(csv 分隔符识别 + 同义词表头映射),
 * 差别在于对账单的必需列是「金额」或「数量+单价」之一 ——
 * 实务里有的对账单只给金额,有的只给数量单价。
 *
 * 纪律:
 * - 金额与数量单价**都缺**的行报错,不静默丢弃、也不当 0;
 * - 到期日识别不出就留 null,由账龄模块归入「到期日未知」而不是猜一个;
 * - 币种识别不出留 null,由调用方按对账单币种兜底(并在 UI 标注兜底事实)。
 */
import { cellText, detectMapping, missingFields, type MappingResult } from "./column-mapping";
import { detectDelimiter, parseCsv } from "./csv";

export type ReconField =
  | "docNo"
  | "docLineNo"
  | "mpn"
  | "qty"
  | "unitPrice"
  | "amount"
  | "currency"
  | "dueDate";

export const RECON_FIELD_LABELS: Record<ReconField, string> = {
  docNo: "单据号",
  docLineNo: "单据行号",
  mpn: "MPN",
  qty: "数量",
  unitPrice: "单价",
  amount: "金额",
  currency: "币种",
  dueDate: "到期日",
};

const SYNONYMS: Record<ReconField, readonly string[]> = {
  docNo: ["docno", "单据号", "发票号", "送货单号", "单号", "invoice", "invoiceno", "发票编号"],
  docLineNo: ["docline", "行号", "单据行号", "lineno", "line"],
  mpn: ["mpn", "型号", "料号", "partnumber", "pn", "物料编码"],
  qty: ["qty", "quantity", "数量", "出货数量", "入库数量", "开票数量"],
  unitPrice: ["unitprice", "price", "单价", "含税单价", "未税单价"],
  amount: ["amount", "金额", "小计", "价税合计", "合计金额", "total"],
  currency: ["currency", "币种", "货币"],
  dueDate: ["duedate", "到期日", "付款到期日", "账期到期", "due"],
};

/** 至少要能定位到一行的金额来源:金额,或数量+单价 */
const KEY_FIELDS: readonly ReconField[] = ["amount", "qty", "unitPrice"];

export interface ParsedReconLine {
  docNo: string | null;
  docLineNo: number | null;
  mpn: string | null;
  qty: string | null;
  unitPrice: string | null;
  amount: string | null;
  currency: string | null;
  dueDate: string | null;
}

export interface ReconParseResult {
  mapping: MappingResult<ReconField>;
  lines: ParsedReconLine[];
  errors: { row: number; message: string }[];
  notices: string[];
}

function numOrNull(raw: string): string | null {
  const t = raw.trim().replace(/,/g, "").replace(/^[¥$€]/, "");
  if (!t) return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? t : null;
}

function intOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function isoDateOrNull(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return Number.isFinite(Date.parse(`${iso}T00:00:00.000Z`)) ? iso : null;
}

const EMPTY_MAPPING: MappingResult<ReconField> = {
  fields: {},
  headerRowIndex: -1,
  unmapped: [],
  confidence: 0,
};

export function parseReconText(text: string): ReconParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      mapping: EMPTY_MAPPING,
      lines: [],
      errors: [{ row: 0, message: "没有输入内容" }],
      notices: [],
    };
  }

  const rows = parseCsv(trimmed, detectDelimiter(trimmed)).filter((r) =>
    r.some((c) => c.trim() !== ""),
  );
  if (rows.length === 0) {
    return {
      mapping: EMPTY_MAPPING,
      lines: [],
      errors: [{ row: 0, message: "未能从输入中解析出表格" }],
      notices: [],
    };
  }

  const mapping = detectMapping<ReconField>(rows, SYNONYMS, KEY_FIELDS);
  const errors: { row: number; message: string }[] = [];
  const notices: string[] = [];

  const hasAmount = mapping.fields.amount !== undefined;
  const hasQtyPrice =
    mapping.fields.qty !== undefined && mapping.fields.unitPrice !== undefined;
  if (!hasAmount && !hasQtyPrice) {
    errors.push({
      row: mapping.headerRowIndex + 1,
      message:
        "表头里既没有「金额」列,也没有「数量」+「单价」两列 —— 至少要有其中一种才能对账",
    });
    return { mapping, lines: [], errors, notices };
  }

  if (missingFields(mapping, ["docNo"]).length > 0 && mapping.fields.mpn === undefined) {
    errors.push({
      row: mapping.headerRowIndex + 1,
      message: "表头里既没有「单据号」也没有「MPN」—— 无法与我方基准配对",
    });
    return { mapping, lines: [], errors, notices };
  }

  if (mapping.fields.dueDate === undefined) {
    notices.push(
      "未识别到「到期日」列 —— 这些行的账龄将归入「到期日未知」,不会并入 0–30 天",
    );
  }
  if (mapping.fields.currency === undefined) {
    notices.push("未识别到「币种」列 —— 将按对账单设定的币种兜底");
  }

  const lines: ParsedReconLine[] = [];
  for (let i = mapping.headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const get = (f: ReconField): string => cellText(row, mapping.fields[f]) ?? "";

    const docNo = get("docNo").trim() || null;
    const mpn = get("mpn").trim() || null;
    const qty = numOrNull(get("qty"));
    const unitPrice = numOrNull(get("unitPrice"));
    const amount = numOrNull(get("amount"));

    if (!docNo && !mpn && qty === null && unitPrice === null && amount === null) continue;

    if (!docNo && !mpn) {
      errors.push({ row: i + 1, message: "既无单据号也无 MPN,无法配对" });
      continue;
    }
    if (amount === null && (qty === null || unitPrice === null)) {
      errors.push({
        row: i + 1,
        message: "既没有金额,也没有完整的数量与单价 —— 无法确定金额(不按 0 处理)",
      });
      continue;
    }

    const dateRaw = get("dueDate");
    const dueDate = isoDateOrNull(dateRaw);
    if (dateRaw.trim() && dueDate === null) {
      notices.push(`第 ${i + 1} 行到期日「${dateRaw.trim()}」无法识别,该行账龄按未知处理`);
    }

    const cur = get("currency").trim().toUpperCase();
    lines.push({
      docNo,
      docLineNo: intOrNull(get("docLineNo")),
      mpn,
      qty,
      unitPrice,
      amount,
      currency: /^[A-Z]{3}$/.test(cur) ? cur : null,
      dueDate,
    });
  }

  if (lines.length === 0 && errors.length === 0) {
    errors.push({ row: mapping.headerRowIndex + 1, message: "表头之后没有数据行" });
  }
  return { mapping, lines, errors, notices };
}
