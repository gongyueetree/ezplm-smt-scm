/**
 * 列词表:物料主数据批量导入(`lib/domain/part-bulk-import.ts`)。
 * REF-2b 从解析器原样迁出为数据,别名与顺序未改(等价性见 tests/unit/column-vocabulary.test.ts)。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";

export const PART_BULK_VOCABULARY = {
  id: "part-bulk",
  aliases: {
    internalPn: ["internalpn", "internal part number", "内部料号", "料号", "物料编码"],
    mpn: ["mpn", "型号", "制造商料号", "厂商型号", "partnumber", "pn"],
    manufacturer: ["manufacturer", "mfg", "制造商", "厂商"],
    description: ["description", "描述", "中文描述", "规格", "名称"],
    descriptionEn: ["descriptionen", "english description", "英文描述"],
    categoryL1: ["category", "分类", "物料分类", "一级分类", "大类"],
    categoryL2: ["subcategory", "二级分类", "细分类"],
    footprint: ["footprint", "package", "封装"],
    brand: ["brand", "品牌"],
    standardCost: ["standardcost", "std price", "stdprice", "标准价", "标准成本", "std 价格", "std价格"],
    standardCostCurrency: ["standardcostcurrency", "标准价币种", "标准成本币种", "std 币种"],
    msl: ["msl", "湿敏等级"],
    packaging: ["packaging", "包装", "包装方式"],
    reelQty: ["reelqty", "盘装数量", "每盘数量"],
    moq: ["moq", "最小起订量"],
    spq: ["spq", "最小包装"],
    leadTimeDays: ["leadtime", "lead time", "lt", "交期"],
    note: ["note", "remark", "备注"],
  },
  required: ["internalPn", "mpn"],
} as const satisfies ColumnVocabulary<string>;
