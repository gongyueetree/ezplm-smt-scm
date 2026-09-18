/**
 * 列词表:缺料表导入(`lib/domain/shortage-sheet.ts`)。
 * REF-2b 从解析器原样迁出为数据,别名与顺序未改(等价性见 tests/unit/column-vocabulary.test.ts)。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";

export const SHORTAGE_VOCABULARY = {
  id: "shortage",
  aliases: {
    customer: ["客户", "customer", "客户名称"],
    internalPn: ["内部料号", "料号", "internalpn", "物料编码", "pn"],
    manufacturer: ["制造商", "厂商", "manufacturer", "mfg", "品牌"],
    mpn: ["mpn", "型号", "厂商型号", "partnumber"],
    requiredQty: ["需求数量", "需求量", "requiredqty", "需求"],
    availableInventory: ["可用库存", "库存", "availableinventory", "inventory", "onhand"],
    openPoQty: ["在途", "未交", "openpo", "openpoqty", "在途数量"],
    supplier: ["供应商", "supplier", "vendor"],
    eta: ["eta", "预计到货", "到货日期"],
    shortageQty: ["缺口数量", "缺口", "shortage", "shortageqty", "缺料数量"],
    requiredDate: ["需求日期", "requireddate", "需求时间", "要求交期"],
  },
  required: ["mpn", "shortageQty"],
} as const satisfies ColumnVocabulary<string>;
