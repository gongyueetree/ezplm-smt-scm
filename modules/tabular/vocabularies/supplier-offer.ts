/**
 * 列词表:线下供应商报价批量导入(`lib/domain/supplier-offer-import.ts`)。
 * REF-2b 从解析器原样迁出为数据,别名与顺序未改(等价性见 tests/unit/column-vocabulary.test.ts)。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";

export const SUPPLIER_OFFER_VOCABULARY = {
  id: "supplier-offer",
  aliases: {
    supplierCode: ["供应商编码", "供应商代码", "供应商", "supplier", "suppliercode", "vendor"],
    mpn: ["mpn", "型号", "厂商型号", "制造商料号", "partnumber", "pn"],
    manufacturer: ["制造商", "厂商", "品牌", "manufacturer", "mfg", "brand"],
    currency: ["币种", "货币", "currency"],
    moq: ["moq", "最小起订量", "最小订购量"],
    spq: ["spq", "包装量", "最小包装"],
    leadTimeDays: ["交期", "交期(天)", "leadtime", "leadtimedays", "lt", "货期"],
    minQty: ["起订数量", "阶梯数量", "数量", "minqty", "qty", "breakqty"],
    unitPrice: ["单价", "价格", "unitprice", "price"],
  },
  required: ["supplierCode", "mpn", "minQty", "unitPrice"],
} as const satisfies ColumnVocabulary<string>;
