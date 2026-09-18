/**
 * REF-2c 管线 · 单元格阶段:数量解析、页脚识别、MPN 单元格守卫。
 *
 * 从 lib/domain/bom-parse.ts 原样迁来(bom-parse 继续转出),V1 与 V2 共用 ——
 * 这些是"一个格子怎么读"的规则,管线拆分只改编排,不改规则。
 */

/** 页脚:`Page 1 of 3` / `第 1 页,共 3 页`。多页 PDF 每页都有,不是数据 */
export function isPageFooter(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return /^page\s*\d+\s*(of|\/)\s*\d+$/i.test(t) || /^第\s*\d+\s*页(\s*[,,]?\s*共\s*\d+\s*页)?$/.test(t);
}

/**
 * 单元格内容是否可能是 MPN。
 *
 * 用来挡住整段落进料号列的正文 —— PDF 页尾的法律声明会被表格重建
 * 当成某一列的内容(实测 TI 的 BOM 就把"These resources are subject to change…"
 * 落进了 PartNumber 列)。真实 MPN 不会是一个句子。
 */
export function looksLikeMpnCell(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (t.length > 50) return false;
  if ((t.match(/\s/g) ?? []).length >= 3) return false;
  return true;
}

/** 数量:支持 "10"、"10.0"、"10 pcs"、全角数字;失败返回 null 并记 issue */
/**
 * 解析数量。
 *
 * **数量 0 是合法且有意义的**:BOM 里的不贴装件(DNP / Do Not Populate)
 * 就是写 0 —— TI 的规范 BOM 正是这么标的。
 * 把它当成"数量非法"会做两件错事:丢掉这一行的物料信息,
 * 以及在错误列表里刷屏,把真正的错误淹掉。
 * 因此 0 保留为 0 并给一条**提示**(不是错误);负数才是错误。
 */
export function parseQty(raw: string | null): {
  qty: number | null;
  issue?: string;
  notice?: string;
} {
  if (raw === null) return { qty: null, issue: "数量为空" };
  const halfWidth = raw.replace(/[０-９．]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  /*
   * F5 golden 套件抓出的缺陷:`2026/8/1` 落进数量列会被读成 2026 ——
   * 首段数字匹配把日期当成了数量,而 2026 个的采购需求就这么静默出现了。
   * 日期与区间(8-10)形态一律判为无法解析,交人工;
   * 负数守卫在下方,此处只拦「数字-分隔符-数字」的多段形态。
   */
  if (/\d[\/\-年月]\s*\d/.test(halfWidth)) {
    return { qty: null, issue: `数量像日期或区间,不能当数量用:${raw}` };
  }
  const m = halfWidth.match(/-?\d+(\.\d+)?/);
  if (!m) return { qty: null, issue: `数量无法解析:${raw}` };
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return { qty: null, issue: `数量无法解析:${raw}` };
  if (n < 0) return { qty: null, issue: `数量不能为负:${raw}` };
  if (n === 0) return { qty: 0, notice: "数量为 0:不贴装件(DNP),不产生采购需求" };
  return { qty: n };
}
