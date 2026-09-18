/**
 * 型号 / 封装 的相似度打分(纯函数,可完全单测)。
 *
 * 用途:工程侧 BOM 只有 Value(如 `MIC5504-3.3`)和封装(`SOT-23-5`),
 * 拿它去物料库与 ezPLM 里找**最像的几个 MPN**,交人工挑。
 *
 * 为什么不用纯编辑距离:MPN 的信息量分布很不均匀 ——
 * `MIC5504-3.3` 与 `MIC5504-1.2YM5-TR` 的公共**前缀**才是关键证据,
 * 而纯编辑距离会因为后缀长度差异把它们判得很远。
 * 因此这里 = 前缀一致长度 + 三元组重合 + 封装是否吻合 三者加权。
 *
 * 纪律:打分只用于**排序与展示**,绝不据此自动写入 ——
 * 型号选错会一路错到询价、报价与采购。
 */
import { normalizeMpnKey } from "@/modules/parts/domain/part-identity";

/** 归一:大写、去掉所有非字母数字(型号里的 - _ / 空格不承载区分度) */
export function normalizeForCompare(value: string | null | undefined): string {
  // REF-1b:统一到 canonical(纯 ASCII 结果不变;非 ASCII 不再被剥空)
  return normalizeMpnKey(value);
}

/** 公共前缀长度(归一后) */
export function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Dice 系数的三元组相似度(0–1) */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return (2 * hit) / (ta.size + tb.size);
}

/**
 * MPN 相似度(0–1)。
 * 前缀权重更高:元器件型号的「家族」信息几乎都在前缀里。
 */
export function mpnSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const prefix = commonPrefixLength(na, nb);
  // 前缀占比取较短者为分母:短型号是长型号的前缀时应得高分
  const prefixScore = prefix / Math.min(na.length, nb.length);
  const trigram = trigramSimilarity(na, nb);
  return Number((prefixScore * 0.6 + trigram * 0.4).toFixed(4));
}

/** 封装吻合程度:1 完全一致 / 0.6 一方是另一方的前缀 / 0 不一致;信息缺失返回 null */
export function footprintAgreement(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return null; // 缺一边就是「未知」,不能算成不吻合
  if (na === nb) return 1;
  if (na.startsWith(nb) || nb.startsWith(na)) return 0.6;
  return 0;
}

export interface SimilarityQuery {
  /** 待匹配的型号线索(工程 BOM 的 Value,或描述里的型号) */
  value: string | null | undefined;
  /** 归一后的封装代码,如 SOT-23-5 */
  packageCode?: string | null;
  /** 原始封装串(ezPLM 的封装名与 KiCad 同源,常常能直接对上) */
  footprint?: string | null;
}

export interface SimilarityTarget {
  mpn: string;
  manufacturer?: string | null;
  description?: string | null;
  footprint?: string | null;
}

export interface SimilarityScore {
  /** 0–1 综合得分 */
  score: number;
  /** 型号本身的相似度 */
  mpnScore: number;
  /** 封装吻合度;信息不足为 null */
  footprintScore: number | null;
  /** 给人看的判断依据 */
  reasons: string[];
}

/**
 * 综合打分。
 *
 * 封装只作**加减分**,不作硬性过滤 —— 工程 BOM 的封装写法千奇百怪,
 * 用它当硬条件会把正确候选直接筛掉;但封装明显不符时要显著降分并写明原因。
 */
export function scoreSimilarity(query: SimilarityQuery, target: SimilarityTarget): SimilarityScore {
  const mpnScore = mpnSimilarity(query.value, target.mpn);
  const fp =
    footprintAgreement(query.packageCode, target.footprint) ??
    footprintAgreement(query.footprint, target.footprint);

  const reasons: string[] = [];
  const na = normalizeForCompare(query.value);
  const nb = normalizeForCompare(target.mpn);
  const prefix = commonPrefixLength(na, nb);
  if (mpnScore >= 0.9) {
    reasons.push("型号高度接近");
  } else if (prefix >= 4) {
    // 比一句"相似度低"有用得多:直接告诉人共同前缀是什么,他一眼能判断是不是同系列
    reasons.push(`型号前缀「${na.slice(0, prefix)}」一致,后缀不同(相似度 ${mpnScore.toFixed(2)})`);
  } else {
    reasons.push(`型号相似度低(${mpnScore.toFixed(2)})`);
  }

  let score = mpnScore;
  if (fp === 1) {
    score = Math.min(1, score + 0.12);
    reasons.push("封装完全一致");
  } else if (fp === 0.6) {
    score = Math.min(1, score + 0.06);
    reasons.push("封装部分一致");
  } else if (fp === 0) {
    score = Math.max(0, score - 0.2);
    reasons.push("封装不一致");
  } else {
    reasons.push("封装信息不足,未参与打分");
  }

  return {
    score: Number(score.toFixed(4)),
    mpnScore,
    footprintScore: fp,
    reasons,
  };
}

export interface RankedCandidate<T extends SimilarityTarget> {
  target: T;
  score: SimilarityScore;
}

/**
 * 取相似度最高的若干候选。
 *
 * @param minScore 低于该分数一律不返回 —— 与其给一堆无关型号让人逐个排除,
 *   不如老实说"没有可信候选"。
 */
export function rankBySimilarity<T extends SimilarityTarget>(
  query: SimilarityQuery,
  targets: readonly T[],
  options: { limit?: number; minScore?: number } = {},
): RankedCandidate<T>[] {
  const limit = options.limit ?? 5;
  const minScore = options.minScore ?? 0.45;
  return targets
    .map((target) => ({ target, score: scoreSimilarity(query, target) }))
    .filter((r) => r.score.score >= minScore)
    .sort((a, b) => {
      if (b.score.score !== a.score.score) return b.score.score - a.score.score;
      return a.target.mpn.localeCompare(b.target.mpn); // 同分时稳定排序
    })
    .slice(0, limit);
}
