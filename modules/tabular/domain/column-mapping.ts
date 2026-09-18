/**
 * 通用列映射引擎(BOM 与供应商报价共用)。
 *
 * 之前这套逻辑只存在于 bom-parse.ts 里,供应商报价导入只能在路由里用正则硬找价格列 ——
 * 不可测、不可扩展。现抽为通用引擎,字段集由调用方定义。
 *
 * 匹配纪律(PR5 教训):**精确相等恒高于"包含"**,包含匹配中同义词越长越具体;
 * 否则 "制造商料号" 会被 "制造商" 的子串匹配抢走,导致 MPN 列丢失。
 *
 * REF-2b:引擎从 lib/domain 迁来(旧路径保留转发);词表不再散落在各解析器与路由里,
 * 一律以 `ColumnVocabulary` 数据形式登记在 `modules/tabular/vocabularies/`。
 * 三档分数:精确 `10000-rank` > 限定词 `QUALIFIED_SCORE` > 包含 `1000+len`。
 */

/**
 * 归一化列名:去空格/标点、小写。
 *
 * E1a:撇号与斜杠原先**没有**被去掉,于是 `Q'ty` 归一化后仍是 `q'ty`,
 * 匹配不上 `qty` —— 而 `Q'ty` 是 Altium 与国内 EMS 模板里极常见的写法。
 * 后果不是"少认一列",而是**整份文件被 422 拒收**:数量是必需列。
 * 客户说的「正常 BOM 导入,AI 无法全部识别」,这就是其中一种。
 *
 * 同义词也走同一个函数(见 `scoreFieldForCell`)—— 两边口径必须对称,
 * 否则改了这里就会让 `qty/pcs` 这类含斜杠的同义词失效。
 */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_\-.()（）【】\[\]:：#*'’`／/、,,]/g, "")
    .trim();
}

/**
 * 单列对单字段的匹配分数;无匹配返回 0。
 * 精确相等 10000-rank;包含匹配 1000+同义词长度。
 */
export function scoreFieldForCell(cell: string, synonyms: readonly string[]): number {
  // 同义词与列名走同一套归一化 —— 否则 `qty/pcs` 这类含标点的同义词会永远匹配不上
  const norm = synonyms.map((s) => normalizeHeader(s));
  const exact = norm.findIndex((s) => s === cell);
  if (exact >= 0) return 10_000 - exact;
  let best = 0;
  for (const s of norm) {
    if (s && cell.includes(s)) best = Math.max(best, 1_000 + s.length);
  }
  return best;
}

/**
 * 限定词别名:「限定词 + 另一字段的精确别名」整体归属本字段。
 *
 * 为什么需要:包含匹配按"最长命中同义词"取胜,`Customer Part No` 归一为 `customerpartno`,
 * 其中 `partno`(MPN,6 字)比任何客户料号同义词都长 —— **客户料号列被 MPN 抢走**,
 * 客户自编码被当成原厂型号去比价。逐个补 `customerpartno` / `客户型号` / `custpartnumber`…
 * 是补不完的;规则化后,MPN 词表每加一个别名,客户料号自动跟着认。
 *
 * 只认"限定词在开头 + 余下部分**精确等于**某个别名",不做包含 —— 否则 `客户` 会吃掉
 * 标题行里的 `客户:xxx`,把表头行检测带偏。
 */
export interface QualifiedAlias<F extends string> {
  readonly qualifiers: readonly string[];
  readonly of: readonly F[];
  readonly field: F;
}

/** 介于精确(≥ 10000-别名数)与包含(1000+别名长度)之间 */
export const QUALIFIED_SCORE = 5_000;

/**
 * 声明式列词表(数据,不是代码)。
 *
 * - `aliases`:数组顺序即优先级,越靠前越典型;
 * - `ambiguous`:同一词表内**归一化后重名**的别名(如 `part#` 与 `part` 都归一为 `part`)
 *   必须在此登记实际含义 —— 引擎按分数与列序择优,这类重名的结果常与作者本意不同,
 *   未登记即由审计测试拦下(见 tests/unit/column-vocabulary.test.ts)。
 */
export interface ColumnVocabulary<F extends string> {
  readonly id: string;
  readonly aliases: Readonly<Record<F, readonly string[]>>;
  readonly required: readonly F[];
  readonly qualified?: readonly QualifiedAlias<F>[];
  readonly ambiguous?: Readonly<Record<string, string>>;
}

export interface MappingResult<F extends string> {
  fields: Partial<Record<F, number>>;
  headerRowIndex: number;
  unmapped: { index: number; header: string }[];
  confidence: number;
}

/** 列名是否为「限定词 + of 字段的精确别名」 */
function matchesQualified<F extends string>(
  cell: string,
  rule: QualifiedAlias<F>,
  synonyms: Readonly<Record<F, readonly string[]>>,
): boolean {
  for (const q of rule.qualifiers) {
    const prefix = normalizeHeader(q);
    if (!prefix || !cell.startsWith(prefix) || cell.length === prefix.length) continue;
    const rest = cell.slice(prefix.length);
    if (rule.of.some((f) => synonyms[f].some((s) => normalizeHeader(s) === rest))) return true;
  }
  return false;
}

/** 对单行表头做贪心择优分配 */
function mapHeaderRow<F extends string>(
  header: readonly string[],
  synonyms: Readonly<Record<F, readonly string[]>>,
  qualified: readonly QualifiedAlias<F>[],
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
    for (const rule of qualified) {
      if (matchesQualified(cell, rule, synonyms)) {
        triples.push({ index, field: rule.field, score: QUALIFIED_SCORE });
      }
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
  qualified: readonly QualifiedAlias<F>[] = [],
): MappingResult<F> {
  const fieldCount = Object.keys(synonyms).length;
  let best: MappingResult<F> = { fields: {}, headerRowIndex: 0, unmapped: [], confidence: 0 };

  const scan = Math.min(rows.length, maxScanRows);
  for (let i = 0; i < scan; i++) {
    const { fields, unmapped } = mapHeaderRow(rows[i] ?? [], synonyms, qualified);
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

/** 按声明式词表检测表头与映射 */
export function detectVocabularyMapping<F extends string>(
  rows: readonly (readonly string[])[],
  vocabulary: ColumnVocabulary<F>,
  maxScanRows = 10,
): MappingResult<F> {
  return detectMapping(rows, vocabulary.aliases, vocabulary.required, maxScanRows, vocabulary.qualified ?? []);
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
