/**
 * 供应商预设批量导入解析(纯函数)。
 *
 * N-9(客户 PR2 反馈 采购-6B:「供应商与采购策略…需要批量导入」)。
 *
 * 表格形态:**一行一档阶梯价** —— 与 D-2 页面上的分行录入口径一致。
 * 同一个(供应商 + MPN)的多档价写成多行,导入时按这两个键聚合:
 *
 *   供应商编码, MPN, 制造商, 币种, MOQ, SPQ, 交期, 起订数量, 单价
 *   SUP-A,     STM32, ST,   CNY,  100, 100, 21,  1,        12.5
 *   SUP-A,     STM32, ST,   CNY,  100, 100, 21,  1000,     11.8
 *
 * 纪律:
 * - **不静默丢行**。缺列、数量非正、单价为空,一律带行号报出来 ——
 *   少一档价会直接改变比价结论,而人以为自己导进去了;
 * - 同一(供应商, MPN)内起订数量重复 → 报错,不让后一档悄悄覆盖前一档;
 * - MOQ/SPQ/交期取该组**第一条非空**值,并在组内出现冲突时报出来,
 *   不按"最后一条赢"这种没人能预期的规则处理。
 */
import { detectVocabularyMapping, missingFields, type ColumnVocabulary } from "@/modules/tabular/domain/column-mapping";
import { SUPPLIER_OFFER_VOCABULARY } from "@/modules/tabular/vocabularies/supplier-offer";
import { checkUsablePrice } from "./price-guard";

export type SupplierOfferField =
  | "supplierCode"
  | "mpn"
  | "manufacturer"
  | "currency"
  | "moq"
  | "spq"
  | "leadTimeDays"
  | "minQty"
  | "unitPrice";

export const OFFER_FIELD_LABEL: Record<SupplierOfferField, string> = {
  supplierCode: "供应商编码",
  mpn: "MPN",
  manufacturer: "制造商",
  currency: "币种",
  moq: "MOQ",
  spq: "SPQ",
  leadTimeDays: "交期(天)",
  minQty: "起订数量",
  unitPrice: "单价",
};

const VOCABULARY: ColumnVocabulary<SupplierOfferField> = SUPPLIER_OFFER_VOCABULARY;

const REQUIRED = VOCABULARY.required;

export interface ParsedOfferGroup {
  supplierCode: string;
  mpn: string;
  manufacturer: string | null;
  currency: string;
  moq: number | null;
  spq: number | null;
  leadTimeDays: number | null;
  priceBreaks: { minQty: number; unitPrice: string }[];
  /** 该组来自表格的哪些行(1-based),报错定位用 */
  sourceRows: number[];
}

export interface OfferImportResult {
  groups: ParsedOfferGroup[];
  errors: { row: number; message: string }[];
  notices: string[];
}

function num(v: string | undefined): number | null {
  const t = (v ?? "").trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseSupplierOfferGrid(rawGrid: string[][]): OfferImportResult {
  const grid = rawGrid.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (grid.length === 0) {
    return { groups: [], errors: [{ row: 0, message: "未能解析出表格" }], notices: [] };
  }

  const mapping = detectVocabularyMapping(grid, VOCABULARY);
  const missing = missingFields(mapping, REQUIRED);
  if (missing.length > 0) {
    return {
      groups: [],
      errors: [
        {
          row: mapping.headerRowIndex + 1,
          message: `缺少必需列:${missing.map((f) => OFFER_FIELD_LABEL[f]).join("、")}`,
        },
      ],
      notices: [],
    };
  }

  const errors: { row: number; message: string }[] = [];
  const notices: string[] = [];
  const byKey = new Map<string, ParsedOfferGroup>();
  const cell = (row: string[], f: SupplierOfferField): string | undefined => {
    const idx = mapping.fields[f];
    return idx === undefined ? undefined : row[idx];
  };

  for (let i = mapping.headerRowIndex + 1; i < grid.length; i++) {
    const row = grid[i];
    const rowNo = i + 1;

    const supplierCode = (cell(row, "supplierCode") ?? "").trim();
    const mpn = (cell(row, "mpn") ?? "").trim();
    if (!supplierCode || !mpn) {
      errors.push({ row: rowNo, message: "供应商编码与 MPN 都不能为空" });
      continue;
    }

    const minQty = num(cell(row, "minQty"));
    const unitPrice = (cell(row, "unitPrice") ?? "").trim();
    if (minQty === null || minQty <= 0) {
      errors.push({ row: rowNo, message: "起订数量必须是正数" });
      continue;
    }
    // R0-8:与 supplier-quote-parse 同口径 —— 0 不是「便宜」,是「没填」。
    const priceCheck = checkUsablePrice(unitPrice);
    if (!priceCheck.ok) {
      errors.push({ row: rowNo, message: priceCheck.message! });
      continue;
    }

    const key = `${supplierCode}\u0000${mpn}`;
    const currency = ((cell(row, "currency") ?? "").trim() || "CNY").toUpperCase();
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        supplierCode,
        mpn,
        manufacturer: (cell(row, "manufacturer") ?? "").trim() || null,
        currency,
        moq: num(cell(row, "moq")),
        spq: num(cell(row, "spq")),
        leadTimeDays: num(cell(row, "leadTimeDays")),
        priceBreaks: [{ minQty, unitPrice }],
        sourceRows: [rowNo],
      });
      continue;
    }

    // 同一档重复 → 报错。后一档覆盖前一档是没人能预期的行为
    if (existing.priceBreaks.some((b) => b.minQty === minQty)) {
      errors.push({
        row: rowNo,
        message: `${supplierCode} / ${mpn} 的起订数量 ${minQty} 重复(第 ${existing.sourceRows.join("、")} 行已出现)`,
      });
      continue;
    }
    // 组内主数据冲突要说出来,而不是悄悄用第一条
    if (existing.currency !== currency) {
      errors.push({
        row: rowNo,
        message: `${supplierCode} / ${mpn} 的币种前后不一致(${existing.currency} vs ${currency})`,
      });
      continue;
    }
    existing.priceBreaks.push({ minQty, unitPrice });
    existing.sourceRows.push(rowNo);
  }

  const groups = [...byKey.values()].map((g) => ({
    ...g,
    priceBreaks: [...g.priceBreaks].sort((a, b) => a.minQty - b.minQty),
  }));

  if (groups.length === 0 && errors.length === 0) {
    errors.push({ row: mapping.headerRowIndex + 1, message: "没有可导入的数据行" });
  }
  const multi = groups.filter((g) => g.priceBreaks.length > 1).length;
  if (multi > 0) notices.push(`${multi} 个(供应商 + MPN)组合有多档阶梯价,已按起订数量升序合并`);

  return { groups, errors, notices };
}
