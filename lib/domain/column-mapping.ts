/**
 * 通用列映射引擎(BOM 与供应商报价共用)。
 *
 * 之前这套逻辑只存在于 bom-parse.ts 里,供应商报价导入只能在路由里用正则硬找价格列 ——
 * 不可测、不可扩展。现抽为通用引擎,字段集由调用方定义。
 *
 * 匹配纪律(PR5 教训):**精确相等恒高于"包含"**,包含匹配中同义词越长越具体;
 * 否则 "制造商料号" 会被 "制造商" 的子串匹配抢走,导致 MPN 列丢失。
 */

/** 归一化列名:去空格/标点、小写 */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_\-.()（）【】\[\]:：#*]/g, "")
    .trim();
}

/**
 * 单列对单字段的匹配分数;无匹配返回 0。
 * 精确相等 10000-rank;包含匹配 1000+同义词长度。
 */
export function scoreFieldForCell(cell: string, synonyms: readonly string[]): number {
  const exact = synonyms.findIndex((s) => s === cell);
  if (exact >= 0) return 10_000 - exact;
  let best = 0;
  for (const s of synonyms) {
    if (cell.includes(s)) best = Math.max(best, 1_000 + s.length);
  }
  return best;
}

export interface MappingResult<F extends string> {
  fields: Partial<Record<F, number>>;
  headerRowIndex: number;
  unmapped: { index: number; header: string }[];
  confidence: number;
}

/** 对单行表头做贪心择优分配 */
function mapHeaderRow<F extends string>(
  header: readonly string[],
  synonyms: Readonly<Record<F, readonly string[]>>,
): { fields: Partial<Record<F, number>>; unmapped: { index: number; header: string }[] } {
  const entries = Object.entries(synonyms) as [F, readonly string[]][];
  const triples: { index: number; field: F; score: number }[] = [];

  header.forEach((rawCell, index) => {
    const cell = normalizeHeader(rawCell ?? "");
    if (!cell) return;
    for (const [field, syns] of entries) {
      const score = scoreFieldForCell(cell, syns);
      if (score > 0) triples.push({ index, field, score });
    }
  });

  // 分数高者先占位;同分按列序、字段名排序,保证结果确定
  triples.sort((a, b) => b.score - a.score || a.index - b.index || a.field.localeCompare(b.field));

  const fields: Partial<Record<F, number>> = {};
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
 * 检测表头行并生成映射。
 * 非标准表格常见前几行是标题/客户信息,故在前 maxScanRows 行中选"识别字段最多"的一行。
 */
export function detectMapping<F extends string>(
  rows: readonly (readonly string[])[],
  synonyms: Readonly<Record<F, readonly string[]>>,
  requiredFields: readonly F[],
  maxScanRows = 10,
): MappingResult<F> {
  const fieldCount = Object.keys(synonyms).length;
  let best: MappingResult<F> = { fields: {}, headerRowIndex: 0, unmapped: [], confidence: 0 };

  const scan = Math.min(rows.length, maxScanRows);
  for (let i = 0; i < scan; i++) {
    const { fields, unmapped } = mapHeaderRow(rows[i] ?? [], synonyms);
    const identified = Object.keys(fields).length;
    if (identified === 0) continue;
    const requiredHit = requiredFields.filter((f) => fields[f] !== undefined).length;
    const confidence =
      (requiredFields.length === 0 ? 1 : requiredHit / requiredFields.length) * 0.7 +
      (identified / fieldCount) * 0.3;
    if (confidence > best.confidence) {
      best = { fields, headerRowIndex: i, unmapped, confidence: Number(confidence.toFixed(4)) };
    }
  }
  return best;
}

export function missingFields<F extends string>(
  mapping: MappingResult<F>,
  requiredFields: readonly F[],
): F[] {
  return requiredFields.filter((f) => mapping.fields[f] === undefined);
}

/** 取单元格文本;空串归一为 null */
export function cellText(
  row: readonly string[] | undefined,
  index: number | undefined,
): string | null {
  if (!row || index === undefined) return null;
  const v = row[index];
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
