/**
 * 列词表:PO 批量粘贴(`lib/domain/po-bulk-input.ts`)。
 * REF-2b 从解析器原样迁出为数据,别名与顺序未改(等价性见 tests/unit/column-vocabulary.test.ts)。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";

export const PO_BULK_VOCABULARY = {
  id: "po-bulk",
  aliases: {
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
  },
  required: ["mpn", "qty"],
} as const satisfies ColumnVocabulary<string>;
