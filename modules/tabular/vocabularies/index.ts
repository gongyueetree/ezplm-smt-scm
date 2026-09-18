/**
 * 全部列词表的登记处(REF-2b)。
 *
 * 新增任何表格导入都必须在此登记 —— 跨词表审计(同一列名在不同词表归属不同含义)
 * 只看得见登记过的词表;散落在路由或组件里的词表就是 D5 的来源。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";
import { ALTERNATE_VOCABULARY } from "./alternate";
import { BOM_VOCABULARY } from "./bom";
import { PART_BULK_VOCABULARY } from "./part-bulk";
import { PO_BULK_VOCABULARY } from "./po-bulk";
import { RECON_VOCABULARY } from "./recon";
import { SCRAP_VOCABULARY } from "./scrap";
import { SHORTAGE_VOCABULARY } from "./shortage";
import { SUPPLIER_OFFER_VOCABULARY } from "./supplier-offer";
import { SUPPLIER_QUOTE_VOCABULARY } from "./supplier-quote";
import { TRACE_RECEIPT_VOCABULARY, TRACE_SHIPMENT_VOCABULARY, TRACE_WO_ISSUE_VOCABULARY } from "./trace";

export const ALL_VOCABULARIES: readonly ColumnVocabulary<string>[] = [
  BOM_VOCABULARY,
  SUPPLIER_QUOTE_VOCABULARY,
  SUPPLIER_OFFER_VOCABULARY,
  RECON_VOCABULARY,
  PO_BULK_VOCABULARY,
  PART_BULK_VOCABULARY,
  TRACE_RECEIPT_VOCABULARY,
  TRACE_WO_ISSUE_VOCABULARY,
  TRACE_SHIPMENT_VOCABULARY,
  ALTERNATE_VOCABULARY,
  SHORTAGE_VOCABULARY,
  SCRAP_VOCABULARY,
];
