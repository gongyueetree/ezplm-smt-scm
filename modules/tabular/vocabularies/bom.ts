/**
 * 列词表:BOM 导入(`lib/domain/bom-parse.ts`)。
 *
 * REF-2b 从解析器原样迁出为数据:别名与顺序未改(等价性见 tests/unit/column-vocabulary.test.ts)。
 * 比较前与列名走同一套 `normalizeHeader`(小写、去空格与标点);数组顺序即优先级。
 *
 * ## 「料号」:BOM 里是**内部料号**,刻意不采纳 bom2buy 的"单独出现即 MPN"
 *
 * 乾创全部文档里「料号」都指其 ERP 物料编码 —— 「优先匹配系统内部料号」「无料号写待补内部料号」
 * 「新料号的编码规则(前缀/流水位数)」(docs/customer-feedback/CUSTOMER-ANSWERS-R1.md、OPEN-QUESTIONS.md O7/N1)。
 * 把只有「料号」列的 BOM 当 MPN,会拿 `1-01-0001` 这类内部编码去原厂与分销商比价;
 * 维持内部料号,缺 MPN 的事实由 `missingRecommendedFields` 如实提示,不猜。
 * 供应商报价 / 对账单 / 损耗词表里「料号」指 MPN —— 那是对方发来的表,口径不同,
 * 已在 `CROSS_VOCABULARY_DIVERGENCES` 逐条登记理由。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";

export const BOM_VOCABULARY = {
  id: "bom",
  aliases: {
    // KiCad 导出用 Reference(s);Altium 用 Designator
    refDes: [
      "位号", "refdes", "reference", "references", "reference(s)", "ref", "refs",
      "designator", "designators", "部位号", "位置号", "元件位号",
    ],
    // KiCad 的 Qnty 是拼写省略,不是错别字;别把它漏了
    // E1a:`Q'ty` / `Q’ty`(Altium、国内 EMS 模板常用)原先认不出来,
    // 而数量是必需列 —— 认不出的后果是**整份文件被拒收**,不是少认一列。
    qty: [
      "数量", "用量", "qty", "q'ty", "q’ty", "qnty", "quantity", "qty/pcs",
      "单板用量", "使用数量", "个数", "pcs", "用量/pcs", "数量qty",
    ],
    mpn: [
      "mpn", "mfrp/n", "mfgp/n", "manufacturerp/n", "p/n", "制造商料号", "厂商料号", "原厂型号", "型号", "partnumber", "partno", "part#", "partnum",
      "mfgpn", "mfrpn", "mfgpartnumber", "manufacturerpartnumber", "manufacturerpart", "mfrpart#",
      "规格型号", "厂家型号", "原厂料号", "supplierpartnumber",
    ],
    manufacturer: [
      "制造商", "厂商", "品牌", "生产厂家", "manufacturer", "manufacture", "mfg", "mfr", "brand",
      "vendor", "supplier", "厂牌", "生产商",
    ],
    customerPn: ["客户料号", "客户物料编码", "customerpn", "customerpartnumber", "custpn", "客户编码"],
    internalPn: ["内部料号", "物料编码", "料号", "internalpn", "itemcode", "partcode", "物料号", "编码"],
    // KiCad/Altium 的 Value、Comment 就是这一行的实质描述,没有它这些 BOM 全是空行
    description: [
      "描述", "规格", "说明", "description", "desc", "spec", "specification", "品名",
      "value", "值", "comment", "注释", "名称", "part", "component",
    ],
    footprint: ["封装", "footprint", "package", "packagetype", "外形", "封装形式", "pattern"],
  },
  /**
   * 只强制 qty —— 大量工程侧 BOM(KiCad/Altium 直接导出)**根本没有 MPN 列**,
   * 设为必填会让它们直接 422;缺 MPN 由校验逐行提示(见 bom-parse `RECOMMENDED_FIELDS`)。
   */
  required: ["qty"],
  /**
   * `Customer Part No` / `客户型号` / `Cust Part Number` 归客户料号。
   * REF-2b 前它们被 MPN 的包含匹配抢走(`partno` 比任何客户料号同义词都长),
   * 客户自编码被当成原厂型号去比价。
   */
  qualified: [
    { qualifiers: ["customer", "cust", "客户"], of: ["mpn", "internalPn"], field: "customerPn" },
  ],
  ambiguous: {
    /**
     * `part#`(mpn)与 `part`(description)归一后同为 `part`。实际行为(REF-2b 前即如此,保留):
     * 单独一列 `Part` → **MPN**(`part#` 排位更靠前);同表另有更强的 MPN 列
     * (`Part Number` / `MPN`)时,MPN 被占,`Part` 落到描述。
     */
    part: "默认 MPN;另有更强 MPN 列时为描述",
  },
} as const satisfies ColumnVocabulary<string>;
