import {
  cellText,
  detectMapping,
  missingFields,
  type MappingResult,
} from "./column-mapping";
import { inferMpnFromValue, parseKicadFootprint } from "./kicad-value";

/**
 * BOM 列映射与标准化(SPEC §6:列映射、非标准 BOM 转标准结构)。
 *
 * 纪律:
 * - 自动识别只产出「建议映射 + 置信度」,人工可覆盖;不确定的列一律留空而不是猜。
 * - 数量解析失败不静默填 1 —— 记 issue,由人工处理(错误的用量会一路错到报价)。
 */

/** 标准 BOM 行字段(与 Prisma BOMLine 对齐) */
export type BomField =
  | "refDes"
  | "qty"
  | "mpn"
  | "manufacturer"
  | "customerPn"
  | "internalPn"
  | "description"
  | "footprint";

export const BOM_FIELD_LABELS: Record<BomField, string> = {
  refDes: "位号",
  qty: "数量",
  mpn: "制造商料号 MPN",
  manufacturer: "制造商",
  customerPn: "客户料号",
  internalPn: "内部料号",
  description: "描述",
  footprint: "封装",
};

/**
 * 列名同义词表(小写比较,已去除空格与标点)。
 * 顺序即优先级:越靠前越"典型",用于多列命中同一字段时选优。
 */
const SYNONYMS: Record<BomField, string[]> = {
  // KiCad 导出用 Reference(s);Altium 用 Designator
  refDes: [
    "位号", "refdes", "reference", "references", "reference(s)", "ref", "refs",
    "designator", "designators", "部位号", "位置号", "元件位号",
  ],
  // KiCad 的 Qnty 是拼写省略,不是错别字;别把它漏了
  qty: ["数量", "用量", "qty", "qnty", "quantity", "qty/pcs", "单板用量", "使用数量", "个数", "pcs"],
  mpn: [
    "mpn", "制造商料号", "厂商料号", "原厂型号", "型号", "partnumber", "partno", "part#", "partnum",
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
};

export type ColumnMapping = MappingResult<BomField>;

/**
 * 关键字段:缺它就无法形成 BOM 行。
 *
 * 只强制 qty —— 大量工程侧 BOM(KiCad/Altium 直接导出)只有
 * 位号 / 数量 / Value / 封装,**根本没有 MPN 列**。
 * 把 MPN 也设为必填会让这类文件直接 422 被拒之门外;
 * 正确做法是让它进来,再由校验逐行提示"缺 MPN,无法匹配与比价"。
 */
const REQUIRED_FIELDS: BomField[] = ["qty"];

/** 强烈建议但不强制的字段:缺了会在导入结果里明确提示 */
export const RECOMMENDED_FIELDS: BomField[] = ["mpn"];

/** 缺失的建议字段(用于 UI 提示,不阻断导入) */
export function missingRecommendedFields(mapping: ColumnMapping): BomField[] {
  return RECOMMENDED_FIELDS.filter((f) => mapping.fields[f] === undefined);
}

/**
 * 检测表头行并生成建议映射(委托通用引擎 lib/domain/column-mapping.ts)。
 * 非标准 BOM 常见前几行是标题/客户信息,故在前 maxScanRows 行中选"识别字段最多"的一行。
 */
export function detectColumnMapping(rows: string[][], maxScanRows = 10): ColumnMapping {
  return detectMapping(rows, SYNONYMS, REQUIRED_FIELDS, maxScanRows);
}

/** 映射是否可用于导入 */
export function isMappingUsable(mapping: ColumnMapping): boolean {
  return REQUIRED_FIELDS.every((f) => mapping.fields[f] !== undefined);
}

export function missingRequiredFields(mapping: ColumnMapping): BomField[] {
  return missingFields(mapping, REQUIRED_FIELDS);
}

/**
 * 文本是否是一串位号(如 `C103, C201, C202,`)。
 *
 * 用于识别 PDF 里**换行的位号列表**:一格装不下时会折到下一行,
 * 表格重建后表现为"只有位号列有值、其余全空"的行。
 * 必须与"备注:以上为主料"这类附注区分开 —— 后者是散文,不是位号串。
 */
export function looksLikeRefDesList(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  const parts = t
    .split(/[,,;;]/)
    .map((x) => x.trim())
    .filter((x) => x !== "");
  if (parts.length === 0) return false;
  // 每一段都必须形如「字母开头 + 含数字」:R1 / C101 / U2A / !PCB700 / SH-J700。
  // 允许连字符与下划线 —— 实测 TI 的 BOM 用 SH-J700 这种带连字符的位号。
  return parts.every((x) => /^!?[A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*$/.test(x));
}

/** 数一行位号里有几个位号 */
export function countRefDes(refDes: string | null | undefined): number {
  return (refDes ?? "")
    .split(/[,,;;\s]+/)
    .filter((x) => x.trim() !== "").length;
}

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

/** MPN 的来源:来自独立列,还是从 Value 推断出来的(推断的必须人工确认) */
export type MpnSource = "column" | "inferred-from-value";

export interface ParsedBomLine {
  /** 源文件行号(1 基,含表头行,便于人工回原表定位) */
  sourceRow: number;
  lineNo: number;
  refDes: string | null;
  qty: number | null;
  mpn: string | null;
  manufacturer: string | null;
  customerPn: string | null;
  internalPn: string | null;
  description: string | null;
  footprint: string | null;
  /** MPN 来源;缺省/为 null 表示本行没有 MPN(可选:旧调用点无需构造) */
  mpnSource?: MpnSource | null;
  /** 从封装串归一出的封装代码(如 0603 / SOT-23-5 / QFN-32),取不出为 null */
  packageCode?: string | null;
  /** 本行解析问题(数量非法等) */
  issues: string[];
  /** 本行的提示(不是错误):如 MPN 由 Value 推断,需人工确认 */
  notices?: string[];
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
  const m = halfWidth.match(/-?\d+(\.\d+)?/);
  if (!m) return { qty: null, issue: `数量无法解析:${raw}` };
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return { qty: null, issue: `数量无法解析:${raw}` };
  if (n < 0) return { qty: null, issue: `数量不能为负:${raw}` };
  if (n === 0) return { qty: 0, notice: "数量为 0:不贴装件(DNP),不产生采购需求" };
  return { qty: n };
}

/** 按映射把原始行转为标准 BOM 行(非标准 BOM → 标准结构) */
function buildLines(
  rows: string[][],
  mapping: ColumnMapping,
  mergeContinuations: boolean,
): ParsedBomLine[] {
  const out: ParsedBomLine[] = [];
  let lineNo = 0;

  const headerKey = (rows[mapping.headerRowIndex] ?? [])
    .map((c) => (c ?? "").trim().toUpperCase())
    .join("\u0001");

  for (let r = mapping.headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => (c ?? "").trim() === "")) continue;
    // 翻页重复表头:多页 PDF 每页都会重复一次表头,它不是数据行。
    // (buildPdfTable 只能与"第一行"比对,而表格上方常有标题块,
    //  真正的表头并不在第一行 —— 所以这里按识别出来的表头再挡一次。)
    if (
      row.map((c) => (c ?? "").trim().toUpperCase()).join("\u0001") === headerKey
    ) {
      continue;
    }

    const rawQty = cellText(row, mapping.fields.qty);
    const { qty, issue, notice: qtyNotice } = parseQty(rawQty);
    const mpnCell = cellText(row, mapping.fields.mpn);
    // 整段正文落进料号列时一律不当 MPN(见 looksLikeMpnCell)
    const mpn = looksLikeMpnCell(mpnCell) ? mpnCell : null;
    const customerPn = cellText(row, mapping.fields.customerPn);
    const internalPn = cellText(row, mapping.fields.internalPn);
    const description = cellText(row, mapping.fields.description);

    const refDes = cellText(row, mapping.fields.refDes);
    const footprint = cellText(row, mapping.fields.footprint);
    const manufacturer = cellText(row, mapping.fields.manufacturer);

    /*
     * 判断这一行是不是真的 BOM 行。
     *
     * - 有任一"物料标识"(MPN / 客户料号 / 内部料号 / 描述)→ 是;
     * - 只有位号 → **要看还有没有别的列有值**:
     *   工程侧 BOM(KiCad/Altium)常常只有 位号/数量/Value/封装,没有 MPN,
     *   不认位号就会把整张表当附注丢光(实测导出的 BOM 会解析出 0 行);
     *   但"备注:以上为主料"这种附注也会落在第一列,
     *   它的特征是**整行只有这一个格有值** —— 据此区分,不靠猜文案。
     */
    const hasIdentifier = Boolean(mpn || customerPn || internalPn || description);
    const otherFilled = [rawQty, manufacturer, footprint].filter(Boolean).length;

    /*
     * 续行合并:PDF 里一格装不下的位号列表会折行,
     * 表格重建后是"只有位号列有值"的行。它属于上一行,不是新物料 ——
     * 不合并的话位号会被截断(TI 的 BOM 里 qty=12 却只剩 2 个位号)。
     *
     * 关键判据是**上一行还差位号**:上一行声明 qty=12 但目前只列了 2 个,
     * 说明后面还有。这比"看起来像续行"可靠得多 ——
     * 工程 BOM 里确实存在"有位号有封装但没填数量"的独立行,
     * 只要上一行的位号已经凑够数,就不会把它误并进去。
     */
    const prev = out.length > 0 ? out[out.length - 1] : null;
    const prevExpectsMore =
      prev !== null &&
      prev.qty !== null &&
      countRefDes(prev.refDes) > 0 &&
      countRefDes(prev.refDes) < prev.qty;
    const isContinuation =
      mergeContinuations &&
      prev !== null &&
      prevExpectsMore &&
      qty === null &&
      !mpn &&
      !customerPn &&
      !internalPn &&
      !manufacturer &&
      Boolean(refDes) &&
      looksLikeRefDesList(refDes);
    if (isContinuation) {
      prev.refDes = [prev.refDes, refDes].filter(Boolean).join(" ");
      // 描述/封装也可能跟着折行,补进上一行的空位(不覆盖已有内容)
      if (description && !prev.description) prev.description = description;
      if (footprint && !prev.footprint) prev.footprint = footprint;
      continue;
    }

    /*
     * 一条 BOM 行至少要有**位号或某种料号**。只有描述的行不是物料行:
     * 多页 PDF 的页脚(Page 1 of 3)、以及被折行的描述片段都会长成那样。
     * 页脚直接丢弃;其余描述片段并回上一行的描述,避免白丢信息。
     */
    const hasKey = Boolean(mpn || customerPn || internalPn || refDes);
    if (!hasKey) {
      if (description && !isPageFooter(description) && out.length > 0) {
        const last = out[out.length - 1];
        last.description = [last.description, description].filter(Boolean).join(" ");
      }
      continue;
    }
    if (!hasIdentifier && !(refDes && otherFilled > 0)) continue;

    const issues: string[] = [];
    const notices: string[] = [];
    if (issue) issues.push(issue);
    if (qtyNotice) notices.push(qtyNotice);

    /*
     * 工程侧 BOM 没有 MPN 列时,尝试从 Value 里认出型号。
     *
     * KiCad 的 Value 对不同器件含义不同:无源件是参数(0.1uF/10k),
     * IC 则**就是型号**(CH340E/LPC824M201JHI33)。判据见 kicad-value.ts。
     * 推断结果标记来源,**必须人工确认** —— 猜错型号会一路错到询价与报价。
     */
    let finalMpn = mpn;
    let mpnSource: MpnSource | null = mpn ? "column" : null;
    if (!finalMpn) {
      const inferred = inferMpnFromValue({ value: description, refDes });
      if (inferred) {
        finalMpn = inferred.mpn;
        mpnSource = "inferred-from-value";
        notices.push(inferred.reason);
      }
    }

    if (!finalMpn && !customerPn && !internalPn) {
      issues.push("缺少 MPN / 客户料号 / 内部料号,无法匹配");
    }

    lineNo += 1;
    out.push({
      sourceRow: r + 1,
      lineNo,
      refDes,
      qty,
      mpn: finalMpn,
      manufacturer,
      customerPn,
      internalPn,
      description,
      footprint,
      mpnSource,
      packageCode: parseKicadFootprint(footprint)?.packageCode ?? null,
      issues,
      notices,
    });
  }

  return out;
}

/** 唯一 MPN 数量(决定是否走 ImportJob 分批,SPEC §15) */
export function countUniqueMpns(lines: ParsedBomLine[]): number {
  const set = new Set<string>();
  for (const l of lines) {
    const key = (l.mpn ?? l.internalPn ?? l.customerPn ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (key) set.add(key);
  }
  return set.size;
}

/**
 * 「位号数 == 数量」的吻合率。
 * 用它来客观判断某个解析选择是不是更接近原表,而不是靠猜。
 */
function refDesAgreement(lines: ParsedBomLine[]): number {
  const solid = lines.filter((l) => l.qty !== null && l.refDes);
  if (solid.length === 0) return 0;
  const hit = solid.filter((l) => countRefDes(l.refDes) === l.qty).length;
  return hit / solid.length;
}

/**
 * 按映射把原始行转为标准 BOM 行(非标准 BOM → 标准结构)。
 *
 * 续行合并是**自校准**的:PDF 折行的位号需要合并,但很多 BOM 的
 * 数量根本不等于位号数(一个位号用量 10 也很常见),
 * 那里合并就是错的。所以两种解析都算一遍,取「位号数 == 数量」吻合率更高的那个;
 * 打平时不合并 —— 不确定就别动原始数据。
 */
export function toStandardLines(rows: string[][], mapping: ColumnMapping): ParsedBomLine[] {
  const plain = buildLines(rows, mapping, false);
  const merged = buildLines(rows, mapping, true);
  return refDesAgreement(merged) > refDesAgreement(plain) ? merged : plain;
}
