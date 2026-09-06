/**
 * 采购订单**批量录入**解析(客户 xlsx「采购订单批量录入」)。
 *
 * 采购的实际习惯是从 Excel 里整块复制粘贴,所以这里吃"带表头的分隔文本"
 * (Tab / 逗号 / 分号自动识别),表头用同义词匹配,顺序随意、缺列可容忍。
 *
 * 纪律:
 * - **必需列只有 MPN 与数量**;其余(单价/MOQ/SPQ/交期/需求日)缺了就是缺,
 *   留空并在 notices 里说明,不猜、不填 0 —— 单价填 0 会让复核以为"免费";
 * - 解析不出来的行**逐行报错并带行号**,不静默丢弃;
 * - 数量为 0 视为无效行(采购订单不存在下单 0 颗),给 error 而非静默跳过。
 */
import { detectDelimiter, parseCsv } from "./csv";
import { cellText, detectMapping, missingFields, type MappingResult } from "./column-mapping";

export type PoBulkField =
  | "mpn"
  | "manufacturer"
  | "description"
  | "qty"
  | "unitPrice"
  | "currency"
  | "moq"
  | "spq"
  | "leadTimeDays"
  | "requestDate";

export const PO_BULK_FIELD_LABELS: Record<PoBulkField, string> = {
  mpn: "MPN",
  manufacturer: "制造商",
  description: "描述",
  qty: "数量",
  unitPrice: "单价",
  currency: "币种",
  moq: "MOQ",
  spq: "SPQ",
  leadTimeDays: "交期(天)",
  requestDate: "需求日期",
};

const SYNONYMS: Record<PoBulkField, readonly string[]> = {
  mpn: ["mpn", "型号", "厂商型号", "制造商型号", "partnumber", "part number", "pn", "料号"],
  manufacturer: ["manufacturer", "mfg", "制造商", "厂商", "品牌", "brand"],
  description: ["description", "desc", "描述", "规格", "名称"],
  qty: ["qty", "quantity", "数量", "订购量", "采购量", "订单数量"],
  unitPrice: ["unitprice", "price", "单价", "含税单价", "未税单价"],
  currency: ["currency", "币种", "货币"],
  moq: ["moq", "最小起订量", "最小订购量"],
  spq: ["spq", "包装量", "标准包装", "最小包装"],
  leadTimeDays: ["leadtime", "lead time", "lt", "交期", "交期天数", "货期"],
  requestDate: ["requestdate", "request date", "需求日期", "需求日", "要求交期", "客户需求日"],
};

const REQUIRED: readonly PoBulkField[] = ["mpn", "qty"];

export interface ParsedPoBulkLine {
  lineNo: number;
  mpn: string | null;
  manufacturer: string | null;
  description: string | null;
  qty: string;
  unitPrice: string | null;
  currency: string | null;
  moq: number | null;
  spq: number | null;
  leadTimeDays: number | null;
  requestDate: string | null;
}

export interface PoBulkParseResult {
  mapping: MappingResult<PoBulkField>;
  lines: ParsedPoBulkLine[];
  /** 逐行错误(带原始行号),不静默丢弃 */
  errors: { row: number; message: string }[];
  /** 非致命提示:缺列、缺值等 */
  notices: string[];
}

function toIntOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** 数值串:保留原始精度交给 Decimal,只做基本合法性判断 */
function toNumericStringOrNull(raw: string): string | null {
  const t = raw.trim().replace(/,/g, "").replace(/^[¥$€]/, "");
  if (!t) return null;
  return /^\d+(\.\d+)?$/.test(t) ? t : null;
}

/** 日期:接受 2026-09-01 / 2026/9/1;识别不出返回 null(不猜) */
function toIsoDateOrNull(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return Number.isFinite(Date.parse(`${iso}T00:00:00.000Z`)) ? iso : null;
}

export function parsePoBulkText(text: string): PoBulkParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      mapping: { fields: {}, headerRowIndex: -1, unmapped: [], confidence: 0 },
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
      mapping: { fields: {}, headerRowIndex: -1, unmapped: [], confidence: 0 },
      lines: [],
      errors: [{ row: 0, message: "未能从输入中解析出表格" }],
      notices: [],
    };
  }

  const mapping = detectMapping<PoBulkField>(rows, SYNONYMS, REQUIRED);
  const errors: { row: number; message: string }[] = [];
  const notices: string[] = [];

  const missing = missingFields(mapping, REQUIRED);
  if (missing.length > 0) {
    errors.push({
      row: mapping.headerRowIndex + 1,
      message: `缺少必需列:${missing.map((f) => PO_BULK_FIELD_LABELS[f]).join("、")}。表头需含 ${missing
        .map((f) => SYNONYMS[f].slice(0, 3).join("/"))
        .join(" 与 ")}`,
    });
    return { mapping, lines: [], errors, notices };
  }

  for (const f of ["unitPrice", "leadTimeDays", "requestDate", "moq", "spq"] as PoBulkField[]) {
    if (mapping.fields[f] === undefined) {
      notices.push(`未识别到「${PO_BULK_FIELD_LABELS[f]}」列 —— 该字段将留空,不做默认值填充`);
    }
  }

  const lines: ParsedPoBulkLine[] = [];
  let lineNo = 0;
  for (let i = mapping.headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    // 空行直接跳过(parseCsv 现保留中段空行以对齐行号;空行不该变成「缺 XX」报错)
    if ((row ?? []).every((c) => (c ?? "").trim() === "")) continue;
    const get = (f: PoBulkField): string => cellText(row, mapping.fields[f]) ?? "";

    const mpn = get("mpn").trim();
    const qtyRaw = get("qty");
    const qty = toNumericStringOrNull(qtyRaw);

    if (!mpn && !qty) continue; // 整行空,跳过

    if (!mpn) {
      errors.push({ row: i + 1, message: "缺少 MPN" });
      continue;
    }
    if (qty === null) {
      errors.push({ row: i + 1, message: `数量「${qtyRaw.trim()}」不是有效数值` });
      continue;
    }
    if (Number(qty) <= 0) {
      errors.push({ row: i + 1, message: "数量为 0 —— 采购订单不接受下单 0 颗" });
      continue;
    }

    const priceRaw = get("unitPrice");
    const unitPrice = toNumericStringOrNull(priceRaw);
    if (priceRaw.trim() && unitPrice === null) {
      errors.push({ row: i + 1, message: `单价「${priceRaw.trim()}」不是有效数值` });
      continue;
    }

    const dateRaw = get("requestDate");
    const requestDate = toIsoDateOrNull(dateRaw);
    if (dateRaw.trim() && requestDate === null) {
      errors.push({ row: i + 1, message: `需求日期「${dateRaw.trim()}」无法识别(需 2026-09-01 形式)` });
      continue;
    }

    lineNo += 1;
    const currency = get("currency").trim().toUpperCase();
    lines.push({
      lineNo,
      mpn,
      manufacturer: get("manufacturer").trim() || null,
      description: get("description").trim() || null,
      qty,
      unitPrice,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
      moq: toIntOrNull(get("moq")),
      spq: toIntOrNull(get("spq")),
      leadTimeDays: toIntOrNull(get("leadTimeDays")),
      requestDate,
    });
  }

  if (lines.length === 0 && errors.length === 0) {
    errors.push({ row: mapping.headerRowIndex + 1, message: "表头之后没有数据行" });
  }
  return { mapping, lines, errors, notices };
}
