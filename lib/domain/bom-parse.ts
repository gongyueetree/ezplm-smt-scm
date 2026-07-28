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
  refDes: ["位号", "refdes", "reference", "references", "designator", "designators", "部位号", "位置号"],
  qty: ["数量", "用量", "qty", "quantity", "qty/pcs", "单板用量", "使用数量"],
  mpn: ["mpn", "制造商料号", "厂商料号", "原厂型号", "型号", "partnumber", "partno", "mfgpn", "manufacturerpartnumber", "规格型号"],
  manufacturer: ["制造商", "厂商", "品牌", "生产厂家", "manufacturer", "mfg", "mfr", "brand", "vendor"],
  customerPn: ["客户料号", "客户物料编码", "customerpn", "customerpartnumber", "custpn", "客户编码"],
  internalPn: ["内部料号", "物料编码", "料号", "internalpn", "itemcode", "partcode", "物料号"],
  description: ["描述", "规格", "说明", "description", "desc", "spec", "specification", "品名"],
  footprint: ["封装", "footprint", "package", "packagetype", "外形", "封装形式"],
};

/** 归一化列名:去空格/标点、小写 */
function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_\-.()（）【】\[\]:：#*]/g, "")
    .trim();
}

export interface ColumnMapping {
  /** 字段 → 列索引;未识别的字段不出现 */
  fields: Partial<Record<BomField, number>>;
  /** 表头所在行索引 */
  headerRowIndex: number;
  /** 未能识别的列(索引 + 原始列名),供 UI 展示"这些列被忽略" */
  unmapped: { index: number; header: string }[];
  /** 识别置信度 0–1:已识别的关键字段占比 */
  confidence: number;
}

/** 关键字段:缺任一个都不能算可用的 BOM */
const REQUIRED_FIELDS: BomField[] = ["qty", "mpn"];

/**
 * 单列对单字段的匹配分数;无匹配返回 0。
 * 精确相等恒高于"包含";包含匹配中同义词越长越具体
 * (否则 "制造商料号" 会被 "制造商" 的子串匹配抢走,导致 MPN 列丢失)。
 */
function scoreFieldForCell(cell: string, synonyms: string[]): number {
  const exact = synonyms.findIndex((s) => s === cell);
  if (exact >= 0) return 10_000 - exact;
  let best = 0;
  for (const s of synonyms) {
    if (cell.includes(s)) best = Math.max(best, 1_000 + s.length);
  }
  return best;
}

function mapHeaderRow(header: string[]): {
  fields: Partial<Record<BomField, number>>;
  unmapped: { index: number; header: string }[];
} {
  const entries = Object.entries(SYNONYMS) as [BomField, string[]][];
  const triples: { index: number; field: BomField; score: number }[] = [];

  header.forEach((rawCell, index) => {
    const cell = normalizeHeader(rawCell ?? "");
    if (!cell) return;
    for (const [field, synonyms] of entries) {
      const score = scoreFieldForCell(cell, synonyms);
      if (score > 0) triples.push({ index, field, score });
    }
  });

  // 贪心择优分配:分数高者先占位;同分按列序、字段名排序,保证结果确定
  triples.sort(
    (a, b) => b.score - a.score || a.index - b.index || a.field.localeCompare(b.field),
  );

  const fields: Partial<Record<BomField, number>> = {};
  const usedColumns = new Set<number>();
  for (const t of triples) {
    if (fields[t.field] !== undefined || usedColumns.has(t.index)) continue;
    fields[t.field] = t.index;
    usedColumns.add(t.index);
  }

  const unmapped = header
    .map((h, index) => ({ index, header: h }))
    .filter((c) => !usedColumns.has(c.index) && (c.header ?? "").trim() !== "");

  return { fields, unmapped };
}

/**
 * 检测表头行并生成建议映射。
 * 非标准 BOM 常见前几行是标题/客户信息,故在前 maxScanRows 行中选"识别字段最多"的一行。
 */
export function detectColumnMapping(rows: string[][], maxScanRows = 10): ColumnMapping {
  let best: ColumnMapping = {
    fields: {},
    headerRowIndex: 0,
    unmapped: [],
    confidence: 0,
  };

  const scan = Math.min(rows.length, maxScanRows);
  for (let i = 0; i < scan; i++) {
    const { fields, unmapped } = mapHeaderRow(rows[i] ?? []);
    const identified = Object.keys(fields).length;
    if (identified === 0) continue;
    const requiredHit = REQUIRED_FIELDS.filter((f) => fields[f] !== undefined).length;
    // 置信度:关键字段权重更高
    const confidence =
      (requiredHit / REQUIRED_FIELDS.length) * 0.7 +
      (identified / Object.keys(SYNONYMS).length) * 0.3;
    if (confidence > best.confidence) {
      best = { fields, headerRowIndex: i, unmapped, confidence: Number(confidence.toFixed(4)) };
    }
  }
  return best;
}

/** 映射是否可用于导入 */
export function isMappingUsable(mapping: ColumnMapping): boolean {
  return REQUIRED_FIELDS.every((f) => mapping.fields[f] !== undefined);
}

export function missingRequiredFields(mapping: ColumnMapping): BomField[] {
  return REQUIRED_FIELDS.filter((f) => mapping.fields[f] === undefined);
}

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
  /** 本行解析问题(数量非法等) */
  issues: string[];
}

function cell(row: string[], index: number | undefined): string | null {
  if (index === undefined) return null;
  const v = row[index];
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
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

    const rawQty = cell(row, mapping.fields.qty);
    const { qty, issue } = parseQty(rawQty);
    const mpn = cell(row, mapping.fields.mpn);
    const customerPn = cell(row, mapping.fields.customerPn);
    const internalPn = cell(row, mapping.fields.internalPn);
    const description = cell(row, mapping.fields.description);

    // 整行没有任何可识别标识 → 视为表格附注,不当作 BOM 行
    if (!mpn && !customerPn && !internalPn && !description) continue;

    const issues: string[] = [];
    if (issue) issues.push(issue);
    if (!mpn && !customerPn && !internalPn) issues.push("缺少 MPN / 客户料号 / 内部料号,无法匹配");

    lineNo += 1;
    out.push({
      sourceRow: r + 1,
      lineNo,
      refDes: cell(row, mapping.fields.refDes),
      qty,
      mpn,
      manufacturer: cell(row, mapping.fields.manufacturer),
      customerPn,
      internalPn,
      description,
      footprint: cell(row, mapping.fields.footprint),
      issues,
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
