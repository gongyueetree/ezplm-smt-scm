/**
 * MPN 标准化(SPEC §17 单测项)。
 *
 * 仅用于「匹配 / 去重 / 缓存键」,禁止用于展示或写入报价单 ——
 * 对外展示与落库一律保留供应商返回的原始 MPN 大小写与分隔符。
 */

/** 去除全部非字母数字字符并大写(RC0603FR-07 10KL ≡ rc0603fr0710kl) */
export function normalizeMpn(mpn: string | null | undefined): string {
  if (!mpn) return "";
  return mpn.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** 制造商标准化:大写、压缩空白、去掉常见公司后缀(用于同源去重) */
export function normalizeManufacturer(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(CO|LTD|INC|CORP|CORPORATION|COMPANY|GMBH|LLC|PLC|SA|AG|KK)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 制造商是否匹配(标准化后双向包含)。
 * "Murata" ≡ "Murata Electronics"、"TI" ≢ "Texas Instruments"(缩写不做猜测映射)。
 * query 为空视为不过滤;任一侧标准化后为空则不匹配(不拿空值当通配)。
 */
export function manufacturerMatches(
  actual: string | null | undefined,
  query: string | null | undefined,
): boolean {
  if (!query) return true;
  const a = normalizeManufacturer(actual);
  const q = normalizeManufacturer(query);
  if (!a || !q) return false;
  return a.includes(q) || q.includes(a);
}

/** 标准化后是否同一 MPN(空值一律视为不相等,避免空对空误命中) */
export function mpnEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeMpn(a);
  const nb = normalizeMpn(b);
  return na !== "" && na === nb;
}
