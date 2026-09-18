/**
 * 列词表审计(REF-2b,D5)。
 *
 * 两类问题都是"静默选错列",导入不报错,错的是后面每一步:
 * 1. **同表重名**:归一化后两个字段有同一个别名(如 `part#` 与 `part` 都成 `part`),
 *    实际归属由分数与列序决定,常与作者本意不同;
 * 2. **跨表异义**:同一列名在不同词表里含义不同(如「料号」在 BOM 是内部料号,
 *    在供应商报价里是 MPN)。这可以是正确的 —— 两张表来自不同的人 —— 但必须是**有意**的。
 */
import { normalizeHeader, type ColumnVocabulary } from "./column-mapping";

/**
 * 字段名不同但**含义相同**的归并(纯命名差异,不算异义)。
 * 只收"换个名字"的情形;语义有差别的一律不进这里,而去登记异义理由。
 */
export const FIELD_CONCEPT: Readonly<Record<string, string>> = {
  workOrderNo: "workOrder",
  customerId: "customer",
  lotNo: "lot",
  internalLot: "lot",
  docLineNo: "lineNo",
  poLineNo: "lineNo",
  requiredDate: "requestDate",
  supplierCode: "supplier",
  basePn: "internalPn",
  receivedQty: "qty",
  shippedQty: "qty",
};

const conceptOf = (field: string) => FIELD_CONCEPT[field] ?? field;

/** 同一词表内归一后重名的别名 → 涉及的字段 */
export function withinVocabularyCollisions(v: ColumnVocabulary<string>): Record<string, string[]> {
  const owners = new Map<string, Set<string>>();
  for (const [field, aliases] of Object.entries(v.aliases) as [string, readonly string[]][]) {
    for (const a of aliases) {
      const n = normalizeHeader(a);
      if (!owners.has(n)) owners.set(n, new Set());
      owners.get(n)!.add(field);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [n, fs] of owners) if (fs.size > 1) out[n] = [...fs].sort();
  return out;
}

/** 跨词表:归一后的别名 → 各词表中的归属(仅列出概念不一致者),形如 `bom:internalPn` */
export function crossVocabularyDivergences(
  vocabularies: readonly ColumnVocabulary<string>[],
): Record<string, string[]> {
  const uses = new Map<string, Map<string, Set<string>>>(); // alias → concept → "vocab:field"
  for (const v of vocabularies) {
    for (const [field, aliases] of Object.entries(v.aliases) as [string, readonly string[]][]) {
      for (const a of aliases) {
        const n = normalizeHeader(a);
        if (!uses.has(n)) uses.set(n, new Map());
        const byConcept = uses.get(n)!;
        const c = conceptOf(field);
        if (!byConcept.has(c)) byConcept.set(c, new Set());
        byConcept.get(c)!.add(`${v.id}:${field}`);
      }
    }
  }
  const out: Record<string, string[]> = {};
  for (const [n, byConcept] of [...uses].sort(([a], [b]) => a.localeCompare(b))) {
    if (byConcept.size < 2) continue;
    out[n] = [...byConcept.values()].flatMap((s) => [...s]).sort();
  }
  return out;
}
