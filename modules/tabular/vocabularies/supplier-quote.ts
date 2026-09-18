/**
 * 列词表:供应商报价单解析(`lib/domain/supplier-quote-parse.ts`)。
 * REF-2b 从解析器原样迁出为数据,别名与顺序未改(等价性见 tests/unit/column-vocabulary.test.ts)。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";

export const SUPPLIER_QUOTE_VOCABULARY = {
  id: "supplier-quote",
  aliases: {
    mpn: ["mpn", "制造商料号", "厂商料号", "原厂型号", "型号", "partnumber", "partno", "mfgpn", "manufacturerpartnumber", "规格型号", "料号"],
    manufacturer: ["制造商", "厂商", "品牌", "生产厂家", "manufacturer", "mfg", "mfr", "brand"],
    unitPrice: ["单价", "价格", "报价", "unitprice", "price", "含税单价", "未税单价", "cost"],
    currency: ["币种", "货币", "currency", "curr"],
    moq: ["moq", "最小起订量", "最小订购量", "起订量", "minimumorderquantity", "minorderqty"],
    spq: ["spq", "标准包装量", "包装量", "最小包装", "standardpackage", "pkgqty", "倍数"],
    leadTimeDays: ["leadtime", "交期", "货期", "lt", "交货期", "leadtimedays", "交期天数"],
    description: ["描述", "规格", "说明", "description", "desc", "品名"],
  },
  required: ["mpn", "unitPrice"],
} as const satisfies ColumnVocabulary<string>;
