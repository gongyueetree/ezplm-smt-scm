/**
 * BOM 版本比对(SPEC §6:导入完成后可进入版本比对)。
 * 以「位号集合」为主键比对:位号是电路上的唯一位置,比行号稳定。
 * 无位号的行退化为按 MPN 比对。
 */
import { expandRefDes } from "./bom-validate";
import type { ParsedBomLine } from "./bom-parse";

export type BomDiffType = "added" | "removed" | "qty_changed" | "part_changed" | "unchanged";

export interface BomDiffEntry {
  type: BomDiffType;
  key: string;
  before: ParsedBomLine | null;
  after: ParsedBomLine | null;
  /** 变化说明(人可读) */
  changes: string[];
}

export interface BomDiffSummary {
  added: number;
  removed: number;
  qtyChanged: number;
  partChanged: number;
  unchanged: number;
}

function lineKey(line: ParsedBomLine): string {
  const refs = expandRefDes(line.refDes);
  if (refs.length > 0) return `REF:${[...refs].sort().join(",")}`;
  const pn = (line.mpn ?? line.internalPn ?? line.customerPn ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return pn ? `PN:${pn}` : `ROW:${line.lineNo}`;
}

function samePart(a: ParsedBomLine, b: ParsedBomLine): boolean {
  const norm = (v: string | null) => (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return norm(a.mpn) === norm(b.mpn) && norm(a.manufacturer) === norm(b.manufacturer);
}

/** 比对两个版本;输出按 key 排序,结果确定 */
export function compareBomVersions(
  before: readonly ParsedBomLine[],
  after: readonly ParsedBomLine[],
): { entries: BomDiffEntry[]; summary: BomDiffSummary } {
  const beforeMap = new Map(before.map((l) => [lineKey(l), l]));
  const afterMap = new Map(after.map((l) => [lineKey(l), l]));
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();

  const entries: BomDiffEntry[] = [];
  const summary: BomDiffSummary = {
    added: 0,
    removed: 0,
    qtyChanged: 0,
    partChanged: 0,
    unchanged: 0,
  };

  for (const key of keys) {
    const b = beforeMap.get(key) ?? null;
    const a = afterMap.get(key) ?? null;

    if (!b && a) {
      entries.push({ type: "added", key, before: null, after: a, changes: ["新增行"] });
      summary.added += 1;
      continue;
    }
    if (b && !a) {
      entries.push({ type: "removed", key, before: b, after: null, changes: ["删除行"] });
      summary.removed += 1;
      continue;
    }
    if (!b || !a) continue;

    const changes: string[] = [];
    if (!samePart(b, a)) {
      changes.push(
        `料号变更:${b.manufacturer ?? "-"} ${b.mpn ?? "-"} → ${a.manufacturer ?? "-"} ${a.mpn ?? "-"}`,
      );
    }
    if (b.qty !== a.qty) changes.push(`数量变更:${b.qty ?? "-"} → ${a.qty ?? "-"}`);
    if ((b.footprint ?? "") !== (a.footprint ?? "")) {
      changes.push(`封装变更:${b.footprint ?? "-"} → ${a.footprint ?? "-"}`);
    }

    if (changes.length === 0) {
      entries.push({ type: "unchanged", key, before: b, after: a, changes: [] });
      summary.unchanged += 1;
    } else if (!samePart(b, a)) {
      entries.push({ type: "part_changed", key, before: b, after: a, changes });
      summary.partChanged += 1;
    } else {
      entries.push({ type: "qty_changed", key, before: b, after: a, changes });
      summary.qtyChanged += 1;
    }
  }

  return { entries, summary };
}
