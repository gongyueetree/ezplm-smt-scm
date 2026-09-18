/**
 * 线下供应商报价 Excel 解析(Backlog B5)。
 *
 * 此前只取 MPN + 单价两列,MOQ/SPQ/Lead Time/币种全部丢失 ——
 * 而这些正是比价排名(rankOffers)与异常判定(evaluateFlags)的输入,
 * 缺了会让"最低价"看起来更优、让超交期的报价不被标异常。
 *
 * 纪律沿用 BOM 解析:
 * - 解析不出来返回 null(不猜、不填默认值);
 * - 单价缺失的行**不导入**并记原因,绝不按 0 落库;
 * - 币种以文件内列为准,缺列时回落到导入时指定的币种(显式传入,不默认 CNY)。
 */
import {
  cellText,
  detectVocabularyMapping,
  missingFields,
  type MappingResult,
  type ColumnVocabulary,
} from "@/modules/tabular/domain/column-mapping";
import { SUPPLIER_QUOTE_VOCABULARY } from "@/modules/tabular/vocabularies/supplier-quote";
import { parseLeadTimeDays, parseMoneyString, parseQuantity } from "@/lib/providers/common/parse";

export type SupplierQuoteField =
  | "mpn"
  | "manufacturer"
  | "unitPrice"
  | "currency"
  | "moq"
  | "spq"
  | "leadTimeDays"
  | "description";

export const SUPPLIER_QUOTE_FIELD_LABELS: Record<SupplierQuoteField, string> = {
  mpn: "MPN",
  manufacturer: "制造商",
  unitPrice: "单价",
  currency: "币种",
  moq: "MOQ",
  spq: "SPQ",
  leadTimeDays: "Lead Time",
  description: "描述",
};

const VOCABULARY: ColumnVocabulary<SupplierQuoteField> = SUPPLIER_QUOTE_VOCABULARY;

/** 关键字段:没有 MPN 与单价就不是一份可用的报价表 */
const REQUIRED_FIELDS = VOCABULARY.required;

export type SupplierQuoteMapping = MappingResult<SupplierQuoteField>;

export function detectSupplierQuoteMapping(
  rows: readonly (readonly string[])[],
  maxScanRows = 10,
): SupplierQuoteMapping {
  return detectVocabularyMapping(rows, VOCABULARY, maxScanRows);
}

export function isSupplierQuoteMappingUsable(mapping: SupplierQuoteMapping): boolean {
  return REQUIRED_FIELDS.every((f) => mapping.fields[f] !== undefined);
}

export function missingSupplierQuoteFields(mapping: SupplierQuoteMapping): SupplierQuoteField[] {
  return missingFields(mapping, REQUIRED_FIELDS);
}

export interface ParsedSupplierQuoteLine {
  sourceRow: number;
  mpn: string;
  manufacturer: string | null;
  /** 十进制字符串;解析失败的行不会出现在结果里 */
  unitPrice: string;
  currency: string;
  moq: number | null;
  spq: number | null;
  leadTimeDays: number | null;
  description: string | null;
}

export interface SupplierQuoteParseResult {
  lines: ParsedSupplierQuoteLine[];
  /** 被跳过的行及原因(如实上报,不静默丢弃) */
  skipped: { sourceRow: number; reason: string }[];
}

export interface ParseOptions {
  /** 文件内无币种列时使用;必须显式给出,不默认 CNY */
  fallbackCurrency: string;
}

export function toSupplierQuoteLines(
  rows: readonly (readonly string[])[],
  mapping: SupplierQuoteMapping,
  options: ParseOptions,
): SupplierQuoteParseResult {
  const lines: ParsedSupplierQuoteLine[] = [];
  const skipped: { sourceRow: number; reason: string }[] = [];

  for (let r = mapping.headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => (c ?? "").trim() === "")) continue;
    const sourceRow = r + 1;

    const mpn = cellText(row, mapping.fields.mpn);
    if (!mpn) {
      // 整行无任何内容标识的视为附注,不报错;有其它内容却缺 MPN 的要报
      const hasOther = row.some((c) => (c ?? "").trim() !== "");
      if (hasOther) skipped.push({ sourceRow, reason: "缺少 MPN" });
      continue;
    }

    const rawPrice = cellText(row, mapping.fields.unitPrice);
    const unitPrice = parseMoneyString(rawPrice);
    if (!unitPrice) {
      skipped.push({ sourceRow, reason: `单价无法解析:${rawPrice ?? "(空)"}` });
      continue;
    }
    if (Number(unitPrice) <= 0) {
      skipped.push({ sourceRow, reason: `单价必须大于 0:${rawPrice}` });
      continue;
    }

    const currencyCell = cellText(row, mapping.fields.currency);
    lines.push({
      sourceRow,
      mpn,
      manufacturer: cellText(row, mapping.fields.manufacturer),
      unitPrice,
      currency: (currencyCell ?? options.fallbackCurrency).toUpperCase().slice(0, 3),
      moq: parseQuantity(cellText(row, mapping.fields.moq)),
      spq: parseQuantity(cellText(row, mapping.fields.spq)),
      leadTimeDays: parseLeadTimeDays(cellText(row, mapping.fields.leadTimeDays)),
      description: cellText(row, mapping.fields.description),
    });
  }

  return { lines, skipped };
}
