/**
 * 列词表:追溯三模板导入(`lib/domain/trace-import.ts`)—— 收货 / 工单发料 / 出货。
 * REF-2b 从解析器原样迁出为数据,别名与顺序未改(等价性见 tests/unit/column-vocabulary.test.ts)。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";

export const TRACE_RECEIPT_VOCABULARY = {
  id: "trace.receipt",
  aliases: {
    poNo: ["po", "pono", "采购订单", "采购单号", "po号"],
    poLineNo: ["poline", "行号", "po行号", "采购行号"],
    supplier: ["supplier", "供应商", "厂商"],
    mpn: ["mpn", "型号", "制造商料号"],
    internalPn: ["internalpartnumber", "internal part number", "内部料号", "料号"],
    supplierLot: ["supplierlot", "供应商批次", "厂商批次", "外部批次"],
    internalLot: ["internallot", "内部批次", "批次号", "lot"],
    receivedQty: ["receivedquantity", "received quantity", "收料数量", "入库数量", "数量"],
    receivedAt: ["receiveddate", "received date", "入库时间", "收料日期", "入库日期"],
    dateCode: ["dc", "datecode", "date code", "生产周期"],
    warehouse: ["warehouse", "仓库"],
    location: ["location", "库位"],
  },
  required: ["internalLot", "receivedQty"],
} as const satisfies ColumnVocabulary<string>;

export const TRACE_WO_ISSUE_VOCABULARY = {
  id: "trace.wo-issue",
  aliases: {
    workOrderNo: ["workorder", "work order", "工单", "工单号"],
    product: ["product", "产品", "机型"],
    bomVersion: ["bomversion", "bom version", "bom版本"],
    lotNo: ["materiallot", "material lot", "物料批次", "批次号", "lot"],
    mpn: ["mpn", "型号"],
    issuedQty: ["issuedquantity", "issued quantity", "发料数量", "投料数量"],
    returnedQty: ["returnedquantity", "returned quantity", "退料数量"],
    productionLine: ["productionline", "production line", "产线", "生产线"],
    issuedAt: ["issuetime", "issue time", "发料时间", "投料时间"],
    operator: ["operator", "操作员", "作业员"],
  },
  // 工单用料是全链路最关键的一跳:工单号与批次号缺任一都连不起来
  required: ["workOrderNo", "lotNo", "issuedQty"],
} as const satisfies ColumnVocabulary<string>;

export const TRACE_SHIPMENT_VOCABULARY = {
  id: "trace.shipment",
  aliases: {
    fgLotNo: ["finishedlot", "finished lot", "成品批次", "成品批号"],
    workOrderNo: ["workorder", "work order", "工单", "工单号"],
    customer: ["customer", "客户"],
    customerPo: ["customerpo", "customer po", "客户po", "客户订单"],
    shipmentNo: ["shipmentnumber", "shipment number", "出货单", "出货单号", "送货单"],
    shippedQty: ["shipmentquantity", "shipment quantity", "出货数量"],
    shippedAt: ["shipmentdate", "shipment date", "出货日期", "出货时间"],
  },
  required: ["fgLotNo", "shipmentNo", "shippedQty"],
} as const satisfies ColumnVocabulary<string>;
