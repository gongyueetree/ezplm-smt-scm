/**
 * 替代料「候选」检索的关键字推导(纯函数,可单测)。
 *
 * 背景:ezPLM API Key 查询接口**不提供替代料能力**,DigiKey Substitutions 覆盖也有限,
 * 因此对大量物料"查替代"会得到空结果。这里提供第三条路:
 * 按 MPN 的**系列前缀**在 ezPLM 里检索同系列物料,作为**候选**供工程/采购人工判定。
 *
 * 纪律:
 * - 输出的是「候选」,**不是**已成立的替代关系 —— 命名、类型与 UI 文案都必须保持这个区分;
 * - 前缀推导是启发式的,宁可**返回 null 不检索**,也不产出噪音级别的关键字;
 * - 不做任何"等效/可替代"的结论判定,那是人的职责。
 */

/** 规范化:去掉空白与常见分隔符,统一大写 */
export function normalizeForFamily(mpn: string): string {
  return mpn.trim().toUpperCase().replace(/[\s_]+/g, "");
}

/**
 * 推导用于检索同系列物料的前缀。
 *
 * 规则(按顺序):
 * 1. 规范化后长度 < 6 的型号不推导(前缀太短会把半个库捞回来) → null;
 * 2. 若含 `-`,取第一段(如 `GRM188R71H104KA93D` 无 `-`;`RC0603FR-0710KL` → `RC0603FR`);
 *    第一段长度 < 5 时视为无效切分,回退到规则 3;
 * 3. 否则去掉末尾 3 个字符(典型的封装/容差/编带后缀),但保底保留 6 个字符。
 */
export function familyPrefix(mpn: string): string | null {
  const s = normalizeForFamily(mpn);
  if (s.length < 6) return null;

  const dash = s.indexOf("-");
  if (dash >= 5) return s.slice(0, dash);

  const cut = Math.max(6, s.length - 3);
  const prefix = s.slice(0, cut);
  return prefix.length >= 6 ? prefix : null;
}

export interface CandidateInput {
  mpn: string;
  manufacturer: string | null;
}

/**
 * 过滤检索结果:剔除自身、去重,并保持稳定顺序。
 * 不排序打分 —— 任何"更像替代"的排序都是在暗示结论。
 */
export function filterCandidates<T extends CandidateInput>(
  self: string,
  rows: T[],
  limit = 20,
): T[] {
  const selfKey = normalizeForFamily(self);
  const seen = new Set<string>([selfKey]);
  const out: T[] = [];
  for (const r of rows) {
    const key = normalizeForFamily(r.mpn);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
