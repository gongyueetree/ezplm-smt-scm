/**
 * REF-1a:归一规则**差异测量**(过渡模块,REF-1c 切换完成后连同旧规则一起删除)。
 *
 * 为什么先测量再切换:归一键不是普通函数 ——
 * 它同时是**匹配键**和**唯一约束键**。换规则意味着
 * ① 匹配结果会变;② 库内 `manufacturerPartNoKey` / `manufacturerKey` 要重算;
 * ③ 重算后可能出现**两行撞同一个键**(唯一约束直接失败)。
 *
 * MIGRATION_PLAN §2 把"归一键变化"列为**不能只靠对拍验证**的三类改动之一,
 * 要求额外做 TS↔PG 等价校验与重算迁移。本模块产出那份决策所需的数据:
 * 哪些样本、在哪条规则上、变成了什么。
 *
 * 本模块**只读不改**,不接任何生产路径。
 */
import { normalizeMpnKey } from "./part-identity";
import { manufacturerKey, normalizeManufacturerName } from "./manufacturer-registry";

// 旧规则:逐条 import 真身来比,不复制实现(复制就会和本体漂移)
import { mfgPartNoKey, manufacturerKeyOf } from "@/lib/domain/part-mfg";
import { normalizeMpn, normalizeManufacturer } from "@/lib/providers/common/mpn";
import { normalizeForCompare } from "@/lib/domain/similarity";
import { normalizePnKey } from "@/lib/domain/bom-purpose";
import { normalizePn } from "@/lib/domain/alternate-bulk";
import { normalizeInternalPn } from "@/lib/domain/part-create";

export interface LegacyRule {
  /** 审计里的编号,便于与 DUPLICATION_MATRIX §D1/§D2 对照 */
  id: string;
  /** 实现位置 */
  where: string;
  apply: (v: string) => string;
}

/** §D1 的 MPN/料号归一规则全集(A7 recon-match.matchKey 只 trim+upper,不参与键比较) */
export const LEGACY_MPN_RULES: readonly LegacyRule[] = [
  { id: "A1", where: "lib/domain/part-mfg.ts mfgPartNoKey", apply: (v) => mfgPartNoKey(v) },
  { id: "A2", where: "lib/providers/common/mpn.ts normalizeMpn", apply: (v) => normalizeMpn(v) },
  { id: "A3", where: "lib/domain/similarity.ts normalizeForCompare", apply: (v) => normalizeForCompare(v) },
  { id: "A4", where: "lib/domain/bom-purpose.ts normalizePnKey", apply: (v) => normalizePnKey(v) },
  { id: "A5", where: "lib/domain/alternate-bulk.ts normalizePn", apply: (v) => normalizePn(v) },
  { id: "A6", where: "lib/domain/part-create.ts normalizeInternalPn", apply: (v) => normalizeInternalPn(v) },
];

/** §D2 的厂商归一规则 */
export const LEGACY_MANUFACTURER_RULES: readonly LegacyRule[] = [
  { id: "B1", where: "lib/providers/common/mpn.ts normalizeManufacturer", apply: (v) => normalizeManufacturer(v) },
  { id: "B4", where: "lib/domain/part-mfg.ts manufacturerKeyOf", apply: (v) => manufacturerKeyOf(v) },
];

export interface RuleDivergence {
  ruleId: string;
  where: string;
  /** 与 canonical 结果不同的样本数 */
  differing: number;
  /** 样本总数 */
  total: number;
  /** 归一后变成空串的样本数 —— 这类最危险:整条记录从此永远匹配不上 */
  emptied: number;
  /** 示例(最多 N 条);脱敏由调用方决定是否输出 */
  examples: { sample: string; legacy: string; canonical: string }[];
}

export interface DivergenceReport {
  canonical: string;
  rules: RuleDivergence[];
  /** canonical 规则下发生**撞键**的组数(不同原值归一成同一个键) */
  canonicalCollisions: { key: string; samples: string[] }[];
}

function analyze(
  samples: readonly string[],
  rules: readonly LegacyRule[],
  canonicalFn: (v: string) => string,
  canonicalName: string,
  maxExamples: number,
): DivergenceReport {
  const rows: RuleDivergence[] = rules.map((rule) => {
    const examples: RuleDivergence["examples"] = [];
    let differing = 0;
    let emptied = 0;
    for (const s of samples) {
      const legacy = rule.apply(s);
      const canonical = canonicalFn(s);
      if (legacy === canonical) continue;
      differing += 1;
      // 旧规则把它剥成空串 → 该记录在旧规则下不可匹配(R0-1 的事故形态)
      if (legacy === "" && canonical !== "") emptied += 1;
      if (examples.length < maxExamples) examples.push({ sample: s, legacy, canonical });
    }
    return { ruleId: rule.id, where: rule.where, differing, total: samples.length, emptied, examples };
  });

  // 撞键检测:canonical 规则下,不同原值归一成同一个键
  const byKey = new Map<string, Set<string>>();
  for (const s of samples) {
    const k = canonicalFn(s);
    if (!k) continue;
    const set = byKey.get(k) ?? new Set<string>();
    set.add(s);
    byKey.set(k, set);
  }
  const canonicalCollisions = [...byKey.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([key, set]) => ({ key, samples: [...set].sort() }))
    .sort((a, b) => b.samples.length - a.samples.length || a.key.localeCompare(b.key));

  return { canonical: canonicalName, rules: rows, canonicalCollisions };
}

export function compareMpnKeyRules(
  samples: readonly string[],
  maxExamples = 5,
): DivergenceReport {
  return analyze(samples, LEGACY_MPN_RULES, normalizeMpnKey, "normalizeMpnKey", maxExamples);
}

export function compareManufacturerKeyRules(
  samples: readonly string[],
  maxExamples = 5,
): DivergenceReport {
  return analyze(samples, LEGACY_MANUFACTURER_RULES, manufacturerKey, "manufacturerKey", maxExamples);
}

/** 仅聚合计数的摘要 —— 真实数据下只输出这个(R4 §4:真实值不进报告) */
export function summarizeDivergence(report: DivergenceReport): string[] {
  const lines = report.rules.map(
    (r) =>
      `${r.ruleId} ${r.where}:${r.differing}/${r.total} 不同` +
      (r.emptied > 0 ? `,其中 ${r.emptied} 条被旧规则剥成空串` : ""),
  );
  lines.push(`canonical 撞键组数:${report.canonicalCollisions.length}`);
  return lines;
}

/**
 * **新增撞键**:在 canonical 下同键、而在旧规则下不同键的组。
 *
 * 这是唯一约束真正的风险量 —— `ManufacturerAlias.normalizedAlias`
 * 按租户唯一,旧规则下本来各自独立的两行,重算后会撞在一起,
 * 迁移必须**先合并再重算**,否则迁移直接失败。
 *
 * 反过来,旧规则下就已经同键的组不算风险(它们本来就是同一行)。
 */
export function newCollisionsVsLegacy(
  samples: readonly string[],
  legacy: LegacyRule,
  canonicalFn: (v: string) => string,
): { key: string; legacyKeys: string[]; count: number }[] {
  const byCanonical = new Map<string, Set<string>>();
  for (const s of samples) {
    const k = canonicalFn(s);
    if (!k) continue;
    const set = byCanonical.get(k) ?? new Set<string>();
    set.add(s);
    byCanonical.set(k, set);
  }

  const out: { key: string; legacyKeys: string[]; count: number }[] = [];
  for (const [key, set] of byCanonical) {
    if (set.size < 2) continue;
    // 旧规则下这组是不是**本来就同键**?是的话不算新增
    const legacyKeys = [...new Set([...set].map((s) => legacy.apply(s)))].sort();
    if (legacyKeys.length > 1) out.push({ key, legacyKeys, count: set.size });
  }
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** 展示用归一(非键)的差异 —— 与 B1 比较,便于确认 UI 展示不会突变 */
export function manufacturerDisplayDivergence(samples: readonly string[]): number {
  return samples.filter((s) => normalizeManufacturerName(s) !== normalizeManufacturer(s)).length;
}
