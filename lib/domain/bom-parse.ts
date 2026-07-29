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
export function parseQty(raw: string | null): { qty: number | null; issue?: string } {
  if (raw === null) return { qty: null, issue: "数量为空" };
  const halfWidth = raw.replace(/[０-９．]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  const m = halfWidth.match(/-?\d+(\.\d+)?/);
  if (!m) return { qty: null, issue: `数量无法解析:${raw}` };
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return { qty: null, issue: `数量无法解析:${raw}` };
  if (n <= 0) return { qty: null, issue: `数量必须大于 0:${raw}` };
  return { qty: n };
}

/** 按映射把原始行转为标准 BOM 行(非标准 BOM → 标准结构) */
export function toStandardLines(rows: string[][], mapping: ColumnMapping): ParsedBomLine[] {
  const out: ParsedBomLine[] = [];
  let lineNo = 0;

  for (let r = mapping.headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => (c ?? "").trim() === "")) continue;

    const rawQty = cellText(row, mapping.fields.qty);
    const { qty, issue } = parseQty(rawQty);
    const mpn = cellText(row, mapping.fields.mpn);
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
    if (!hasIdentifier && !(refDes && otherFilled > 0)) continue;

    const issues: string[] = [];
    const notices: string[] = [];
    if (issue) issues.push(issue);

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
