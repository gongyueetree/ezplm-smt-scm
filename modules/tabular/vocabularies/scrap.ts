/**
 * 列词表:损耗数据导入(`app/api/scrap/route.ts`)。
 * REF-2b 前**直接写在 Route Handler 里**;现原样迁出为数据,别名与顺序未改(等价性见 tests/unit/column-vocabulary.test.ts)。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";

export const SCRAP_VOCABULARY = {
  id: "scrap",
  aliases: {
    period: ["period", "期间", "月份", "年月"],
    customerId: ["customer", "客户", "客户编码", "客户代码"],
    workOrder: ["workorder", "工单", "工单号", "wo"],
    mpn: ["mpn", "型号", "料号", "partnumber"],
    issuedQty: ["issued", "发料", "发料数量", "投料数量", "领料数量"],
    scrapQty: ["scrap", "报废", "报废数量", "损耗数量", "损耗"],
    reason: ["reason", "原因", "损耗原因", "报废原因"],
  },
  required: ["issuedQty", "scrapQty"],
} as const satisfies ColumnVocabulary<string>;
