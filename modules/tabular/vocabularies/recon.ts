/**
 * 列词表:对账单解析(`lib/domain/recon-parse.ts`)。`required` 是关键列:至少要能定位到一行的金额来源(金额,或数量+单价),
 * 由调用方逐行判定,不是全必需 —— 只用于表头行选择的置信度。
 * REF-2b 从解析器原样迁出为数据,别名与顺序未改(等价性见 tests/unit/column-vocabulary.test.ts)。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";

export const RECON_VOCABULARY = {
  id: "recon",
  aliases: {
    docNo: ["docno", "单据号", "发票号", "送货单号", "单号", "invoice", "invoiceno", "发票编号"],
    docLineNo: ["docline", "行号", "单据行号", "lineno", "line"],
    mpn: ["mpn", "型号", "料号", "partnumber", "pn", "物料编码"],
    qty: ["qty", "quantity", "数量", "出货数量", "入库数量", "开票数量"],
    unitPrice: ["unitprice", "price", "单价", "含税单价", "未税单价"],
    amount: ["amount", "金额", "小计", "价税合计", "合计金额", "total"],
    currency: ["currency", "币种", "货币"],
    dueDate: ["duedate", "到期日", "付款到期日", "账期到期", "due"],
  },
  required: ["amount", "qty", "unitPrice"],
} as const satisfies ColumnVocabulary<string>;
