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

/** 多制造商串分隔符:"Microchip / Microsemi"、"AVX & Kyocera" 等合并厂商名 */
const MFR_ALIAS_SEPARATORS = /[/&|+]/;

/** 拆出制造商别名列表:"Microchip / Microsemi" → ["MICROCHIP", "MICROSEMI"] */
export function manufacturerAliases(name: string | null | undefined): string[] {
  const norm = normalizeManufacturer(name);
  if (!norm) return [];
  return norm
    .split(MFR_ALIAS_SEPARATORS)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** 单个别名之间的匹配:词序列前缀 或 单词首段前缀(≥4 字符) */
function aliasMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const at = a.split(" ");
  const bt = b.split(" ");
  const [short, long] = at.length <= bt.length ? [at, bt] : [bt, at];
  // 词序列前缀:"MURATA" ≡ "MURATA ELECTRONICS"
  if (short.every((t, i) => long[i] === t)) return true;
  // 单词首段前缀:"STMICRO" ≡ "STMICROELECTRONICS"。
  // 注意此处必须按「字符长度」而非词数取短者(两侧都是单词时词数相同)。
  // 下限 4 字符是防假阳性的护栏 —— "ST"/"TI" 这类两字母缩写在此层不匹配,
  // 缩写别名(ST=STMicroelectronics 等)属 PR5 BOM 匹配管线的别名表职责,provider 层不猜。
  if (short.length === 1) {
    const [s, l] =
      short[0].length <= long[0].length ? [short[0], long[0]] : [long[0], short[0]];
    if (s.length >= 4 && l.startsWith(s)) return true;
  }
  return false;
}

/**
 * 制造商是否匹配(标准化 + 别名拆分 + 词级匹配)。
 * ⚠ 语义:query 为空 = 调用方未指定制造商 = **不过滤**(provider 层不替调用方臆断);
 * 需要"同 MPN 跨厂商不得混入同一比价集合"的,由 rankOffers 的 expectedManufacturer 承担。
 * 任一侧标准化后为空则不匹配(不拿空值当通配)。
 */
export function manufacturerMatches(
  actual: string | null | undefined,
  query: string | null | undefined,
): boolean {
  if (!query) return true;
  const A = manufacturerAliases(actual);
  const Q = manufacturerAliases(query);
  if (A.length === 0 || Q.length === 0) return false;
  return A.some((a) => Q.some((q) => aliasMatches(a, q)));
}

/** 标准化后是否同一 MPN(空值一律视为不相等,避免空对空误命中) */
export function mpnEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeMpn(a);
  const nb = normalizeMpn(b);
  return na !== "" && na === nb;
}
