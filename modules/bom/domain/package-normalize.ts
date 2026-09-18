/**
 * REF-2:封装(Footprint / Package)归一的共享规则。
 *
 * 现状(REF-0 审计 DUPLICATION_MATRIX §D4):5 处各自实现 ——
 *   D4-1 bom-validate.normalizeFootprint  `[^0-9A-Z]` 剥除
 *   D4-2 bom-match 内联                    同上,但**没调用** D4-1
 *   D4-3 similarity.footprintAgreement     REF-1b 起已走 canonical 字符规则
 *   D4-4 part-spec.cleanPackageName 族     类别字母表 **12 个**
 *   D4-5 kicad-value.parseKicadFootprint   类别字母表 **10 个**(缺 CP / FL)
 *
 * REF-2a 只收敛两件**可证明等价或明确是缺陷**的事,不做封装语义推断:
 * 1. 等值比较用的 footprintKey 统一到与 MPN 键同一套字符规则;
 * 2. KiCad 器件类别字母表合一。
 *
 * **刻意不做**(bom2buy 的已知债,不照搬):
 * - 不把任意 4 位数字一律当英制片式尺寸 —— 公制标注的 `0402`(= 英制 01005)
 *   会被静默归错,且无标记;
 * - 不从名字推断封装族/管脚数的新规则 —— part-spec 已有经过实测的实现
 *   (packageFamily / pinCountFromPackage / packageAgreement),保留原样。
 */
import { normalizeMpnKey } from "@/modules/parts/domain/part-identity";

/**
 * KiCad 在封装名前加的**器件类别字母**(`C_0603_1608Metric` 里的 `C`),
 * 它不是封装的一部分,解析封装代码时要去掉。
 *
 * 取 part-spec(12 个)与 kicad-value(10 个)的**并集**:
 * `CP`(极性电容)与 `FL`(滤波器)在 KiCad 约定里与 `C`、`R` 同属类别字母 ——
 * part-spec 早已剥掉它们,kicad-value 没剥,导致 `Capacitor_SMD:CP_Elec_6.3x5.4`
 * 在两处得到不同的封装代码。
 */
export const KICAD_CLASS_PREFIXES = [
  "C",
  "R",
  "L",
  "D",
  "LED",
  "FB",
  "Q",
  "U",
  "SW",
  "J",
  "CP",
  "FL",
] as const;

/** 大小写不敏感的类别字母判定(单独成段时才算) */
export const KICAD_CLASS_SEGMENT = new RegExp(`^(${KICAD_CLASS_PREFIXES.join("|")})$`, "i");

/**
 * 封装**等值比较**用的键:大写 + 只留字母数字(含 CJK)。
 * `SOIC-16` ≡ `SOIC16`,`0603` ≡ `0603`。
 *
 * 与 MPN 键同一套字符规则 —— REF-1 的教训:两处规则不一致就会静默失配。
 * 只用于"是不是同一个封装写法"的判等;封装**兼容性**判断走 part-spec.packageAgreement。
 */
export function footprintKey(raw: string | null | undefined): string {
  return normalizeMpnKey(raw);
}
