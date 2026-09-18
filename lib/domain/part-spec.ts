/**
 * 封装规格解析:封装族 / 管脚数(纯函数,可完全单测)。
 *
 * 找替代料时,光比型号字符串不够 —— 真正决定"能不能换"的是
 * **封装族相同 + 管脚数相同**。`SOT-23-5` 与 `SOT-23-6` 只差一个字符,
 * 但一个 5 脚一个 6 脚,焊上去直接短路。
 *
 * 纪律:认不出来就返回 null(未知),**绝不猜** ——
 * 猜错管脚数会让人以为可以换,是会烧板子的错误。
 */
import { KICAD_CLASS_SEGMENT } from "@/modules/bom/domain/package-normalize";

/** 封装族里"名字后面那个数字就是管脚数"的那一类 */
const PIN_COUNT_IN_NAME = new Set([
  "QFN", "QFP", "TQFP", "LQFP", "VQFN", "WQFN", "HTQFP",
  "SOIC", "SO", "SOP", "SSOP", "TSSOP", "MSOP", "VSSOP", "HTSSOP",
  "DFN", "TDFN", "UDFN", "WDFN",
  "DIP", "PDIP", "SIP", "ZIP",
  "BGA", "FBGA", "TFBGA", "LFBGA", "VFBGA", "WLCSP",
  "PLCC", "LCC", "QFJ", "TO",
]);

/**
 * 名字里不含管脚数的封装,只能查表。
 * (`SOT-23` 是 3 脚而不是 23 脚;`SOD-123` 是 2 脚而不是 123 脚 ——
 *  这类编号是**封装代号**,不是管脚数,按数字取会错得离谱。)
 */
const FIXED_PIN_COUNT: Record<string, number> = {
  "SOT-23": 3,
  "SOT-323": 3,
  "SOT-353": 5,
  "SOT-363": 6,
  "SOT-89": 3,
  "SOT-223": 4,
  "SOD-123": 2,
  "SOD-323": 2,
  "SOD-523": 2,
  "SOD-80": 2,
  "SMA": 2,
  "SMB": 2,
  "SMC": 2,
  "MELF": 2,
};

/** 英制片式尺寸(0402/0603/1206…)都是两端器件 */
const CHIP_SIZE = /^(0075|0100|0201|0402|0603|0805|1206|1210|1218|1812|2010|2512|2920)$/;

function normalize(pkg: string): string {
  return pkg.trim().toUpperCase().replace(/\s+/g, "");
}

/** KiCad 会在封装名前加器件类别字母(C_0603_1608Metric),它不是封装的一部分 */
const CLASS_PREFIX = KICAD_CLASS_SEGMENT; // REF-2a:与 kicad-value 共用一张表

/** 只保留封装名部分:去掉库前缀与类别字母 */
export function cleanPackageName(pkg: string | null | undefined): string | null {
  const raw = (pkg ?? "").trim();
  if (!raw) return null;
  const afterColon = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const normalized = normalize(afterColon);
  if (!normalized) return null;
  const segments = normalized.split("_");
  if (segments.length > 1 && CLASS_PREFIX.test(segments[0])) {
    return segments.slice(1).join("_");
  }
  return normalized;
}

/** 封装族:SOT-23-5 → SOT;TQFP-48_7x7mm → TQFP;0603 → CHIP */
export function packageFamily(pkg: string | null | undefined): string | null {
  const name = cleanPackageName(pkg);
  if (!name) return null;
  const head = name.split(/[-_]/)[0] ?? "";
  if (CHIP_SIZE.test(head)) return "CHIP";
  const alpha = head.match(/^[A-Z]+/)?.[0] ?? "";
  return alpha || null;
}

/**
 * 管脚数。认不出返回 null。
 *
 * 顺序:片式尺寸 → 固定查表 → 族名后跟数字 → SOT/SOD 的「第二段数字」。
 */
export function pinCountFromPackage(pkg: string | null | undefined): number | null {
  const name = cleanPackageName(pkg);
  if (!name) return null;

  const head = name.split(/[-_]/)[0] ?? "";
  if (CHIP_SIZE.test(head)) return 2;

  // 先查固定表(SOT-23 / SOD-123 这类编号不是管脚数)
  const segments = name.split("_")[0]; // 去掉 _7x7mm 之类的尾巴
  for (const [key, pins] of Object.entries(FIXED_PIN_COUNT)) {
    if (segments === key) return pins;
    // SOT-23-5:固定编号后面还跟了真实管脚数
    if (segments.startsWith(`${key}-`)) {
      const rest = segments.slice(key.length + 1);
      const n = Number(rest.split("-")[0]);
      if (Number.isInteger(n) && n > 0 && n <= 2000) return n;
      return pins;
    }
  }

  const family = packageFamily(name);
  if (family && PIN_COUNT_IN_NAME.has(family)) {
    const m = segments.match(new RegExp(`^${family}-?(\\d+)`));
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0 && n <= 2000) return n;
    }
  }

  return null;
}

export interface PackageAgreement {
  /** 归一后字符串完全相同 */
  exact: boolean;
  /** 封装族是否相同;任一方未知为 null */
  family: boolean | null;
  /** 管脚数是否相同;任一方未知为 null */
  pinCount: boolean | null;
  /** 综合结论:true=可直接换板、false=不可、null=信息不足 */
  compatible: boolean | null;
  reasons: string[];
}

/**
 * 两个封装是否可互换。
 *
 * **管脚数不同一律判为不可换** —— 这是硬约束,不是加减分。
 */
export function packageAgreement(
  a: string | null | undefined,
  b: string | null | undefined,
): PackageAgreement {
  const na = cleanPackageName(a);
  const nb = cleanPackageName(b);
  const reasons: string[] = [];

  if (!na || !nb) {
    return { exact: false, family: null, pinCount: null, compatible: null, reasons: ["封装信息不足"] };
  }
  if (na === nb) {
    return { exact: true, family: true, pinCount: true, compatible: true, reasons: ["封装完全一致"] };
  }

  const fa = packageFamily(na);
  const fb = packageFamily(nb);
  const family = fa && fb ? fa === fb : null;

  const pa = pinCountFromPackage(na);
  const pb = pinCountFromPackage(nb);
  const pinCount = pa !== null && pb !== null ? pa === pb : null;

  if (family === true) reasons.push(`封装族相同(${fa})`);
  else if (family === false) reasons.push(`封装族不同(${fa} vs ${fb})`);

  if (pinCount === true) reasons.push(`管脚数相同(${pa})`);
  else if (pinCount === false) reasons.push(`管脚数不同(${pa} vs ${pb})`);
  else reasons.push("管脚数未知");

  // 管脚数不同是硬否决;族相同且管脚相同才算可换
  let compatible: boolean | null;
  if (pinCount === false) compatible = false;
  else if (family === true && pinCount === true) compatible = true;
  else compatible = null;

  return { exact: false, family, pinCount, compatible, reasons };
}
