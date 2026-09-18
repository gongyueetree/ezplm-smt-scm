/**
 * 跨词表异义登记(REF-2b,D5)。
 *
 * 同一列名在不同词表归属不同含义,每一条都必须在这里写明理由;
 * `uses` 是审计函数算出的现状快照 —— 任何词表改动只要改变了某个列名的归属,
 * tests/unit/column-vocabulary.test.ts 就会失败,逼改动者回来重读并更新理由。
 *
 * `status`:
 * - `INTENDED`:两张表出自不同的人/系统,口径本就不同,现状正确;
 * - `PENDING_CUSTOMER`:按乾创已知口径**现状很可能不对**,但改动会移动既有导入结果,
 *   未经客户确认不改(已登记 REFACTOR_BACKLOG R1-6)。
 */
export interface CrossVocabularyDivergence {
  readonly uses: readonly string[];
  readonly status: "INTENDED" | "PENDING_CUSTOMER";
  readonly reason: string;
}

export const CROSS_VOCABULARY_DIVERGENCES: Readonly<Record<string, CrossVocabularyDivergence>> = {
  料号: {
    uses: [
      "bom:internalPn",
      "part-bulk:internalPn",
      "po-bulk:mpn",
      "recon:mpn",
      "scrap:mpn",
      "shortage:internalPn",
      "supplier-quote:mpn",
      "trace.receipt:internalPn",
    ],
    status: "PENDING_CUSTOMER",
    reason:
      "乾创口径「料号」= ERP 物料编码(见 bom.ts 文件头)。supplier-quote 是供应商发来的表,指 MPN 合理;" +
      "但 po-bulk(采购从本方 ERP 粘贴)与 scrap(MES/ERP 损耗导出)同样出自乾创自己的系统,映射到 MPN " +
      "会把内部编码当原厂型号 —— 两者都没有 internalPn 字段可落,需客户确认导出表口径后再改。" +
      "recon 为供应商对账单,其「料号」可能是供应商自己的编码,同样待确认。",
  },
  物料编码: {
    uses: ["bom:internalPn", "part-bulk:internalPn", "recon:mpn", "shortage:internalPn"],
    status: "PENDING_CUSTOMER",
    reason: "recon(供应商对账单)把「物料编码」当 MPN;供应商的物料编码既非本方内部料号也未必是 MPN,待确认对账单样本。",
  },
  pn: {
    uses: ["bom:mpn", "part-bulk:mpn", "po-bulk:mpn", "recon:mpn", "shortage:internalPn", "supplier-offer:mpn"],
    status: "INTENDED",
    reason: "缺料分析单是本方业务单据(PR2-PROC-10),PN 指内部料号;其余表的 P/N 按行业惯例指制造商型号。",
  },
  supplier: {
    uses: ["bom:manufacturer", "shortage:supplier", "supplier-offer:supplierCode", "trace.receipt:supplier"],
    status: "INTENDED",
    reason:
      "BOM 没有供应商字段,Supplier/Vendor 列归制造商(REF-2b 前即如此,未经真实样本验证是否合理," +
      "但改成不映射会让只有该列的 BOM 丢掉品牌信息);其余表有独立的供应商字段,供应商≠制造商。",
  },
  vendor: {
    uses: ["bom:manufacturer", "shortage:supplier", "supplier-offer:supplierCode"],
    status: "INTENDED",
    reason: "同 supplier。",
  },
  厂商: {
    uses: [
      "bom:manufacturer",
      "part-bulk:manufacturer",
      "po-bulk:manufacturer",
      "shortage:manufacturer",
      "supplier-offer:manufacturer",
      "supplier-quote:manufacturer",
      "trace.receipt:supplier",
    ],
    status: "INTENDED",
    reason: "收料单上「厂商」指来料供应商(收料单没有制造商字段);其余表指制造商。",
  },
  brand: {
    uses: [
      "bom:manufacturer",
      "part-bulk:brand",
      "po-bulk:manufacturer",
      "supplier-offer:manufacturer",
      "supplier-quote:manufacturer",
    ],
    status: "INTENDED",
    reason: "物料主数据把品牌与制造商分成两个字段(如代理品牌);其余表只有制造商,品牌即制造商。",
  },
  品牌: {
    uses: [
      "bom:manufacturer",
      "part-bulk:brand",
      "po-bulk:manufacturer",
      "shortage:manufacturer",
      "supplier-offer:manufacturer",
      "supplier-quote:manufacturer",
    ],
    status: "INTENDED",
    reason: "同 brand。",
  },
  客户编码: {
    uses: ["bom:customerPn", "scrap:customerId"],
    status: "INTENDED",
    reason: "BOM 行上的「客户编码」是客户物料编码;损耗表上是客户代码(按客户汇总损耗)。",
  },
  qty: {
    uses: ["bom:qty", "po-bulk:qty", "recon:qty", "supplier-offer:minQty"],
    status: "INTENDED",
    reason: "线下报价表的数量列是价格阶梯起订数量(每行一个阶梯),不是需求数量。",
  },
  数量: {
    uses: ["bom:qty", "po-bulk:qty", "recon:qty", "supplier-offer:minQty", "trace.receipt:receivedQty"],
    status: "INTENDED",
    reason: "同 qty;收料单的数量即收料数量。",
  },
  package: {
    uses: ["alternate:packageCompat", "bom:footprint", "part-bulk:footprint"],
    status: "INTENDED",
    reason: "替代料表的 packageCompat 是必需的封装兼容判定列(是/否),不是封装名;该表没有封装名字段。",
  },
  说明: {
    uses: ["alternate:note", "bom:description", "supplier-quote:description"],
    status: "INTENDED",
    reason: "替代料表另有原因/描述列,「说明」是备注;BOM 与报价单里是物料描述。",
  },
  part: {
    uses: ["bom:description", "bom:mpn"],
    status: "INTENDED",
    reason: "BOM 同表重名(`part#` 与 `part`),实际行为见 bom.ts 的 ambiguous 登记。",
  },
};
