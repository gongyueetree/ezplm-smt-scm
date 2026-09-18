/**
 * 从 KiCad/Altium 工程 BOM 的 Value / Footprint 列里再榨出可用信息(纯函数,可完全单测)。
 *
 * 背景(来自真实样本):这类 BOM 没有 MPN 列,但 **Value 列对不同器件含义完全不同**:
 * - 无源器件:`0.1uF` / `10k` / `16MHz` —— 是**参数**,不是型号;
 * - IC/有源器件:`CH340E` / `LPC824M201JHI33` / `ADA4851-1YRJZ-RL7` —— **就是 MPN**;
 * - 连接器/开关/指示灯:`USB_B_Micro` / `Header_1x5` / `RST` / `PWR` ——
 *   是 KiCad 的符号名或网络标签,既不是参数也不是型号。
 *
 * 因此不能一刀切,必须结合**位号前缀(器件类别)**与 **Value 的形态**共同判断。
 *
 * 纪律:
 * - 推断出的 MPN 一律标记来源为 `inferred-from-value`,由人工确认后才作数 ——
 *   猜错型号会一路错到询价和报价;
 * - 判不准就返回 null,**不给低质量的猜测**。
 */
import { KICAD_CLASS_SEGMENT } from "@/modules/bom/domain/package-normalize";

export type RefDesClass = "passive" | "active" | "connector" | "electromechanical" | "unknown";

/** 位号前缀 → 器件类别(IPC 常用约定) */
const REFDES_PREFIX: [RegExp, RefDesClass][] = [
  [/^(R|RN|RV|VR|C|CN?P|L|FB|FL|BLM)\d/i, "passive"],
  [/^(U|IC|Q|D|LED|T|VT|OP|AR)\d/i, "active"],
  [/^(J|P|CN|CON|X|TP|H)\d/i, "connector"],
  [/^(SW|S|K|RL|BT|BAT|F|FU|Y|XT|LS|SP|M)\d/i, "electromechanical"],
];

/** 取位号列表里的第一个位号判定类别(同一行的位号必然同类) */
export function refDesClass(refDes: string | null | undefined): RefDesClass {
  if (!refDes) return "unknown";
  const first = refDes.split(/[,,;;\s]+/).find((s) => s.trim() !== "");
  if (!first) return "unknown";
  for (const [re, cls] of REFDES_PREFIX) {
    if (re.test(first.trim())) return cls;
  }
  return "unknown";
}

/**
 * Value 是否是**元件参数**(阻值/容值/频率等),而不是型号。
 *
 * 覆盖:`510` `10k` `4.3k` `0.1uF` `15pF` `2.4p` `16MHz` `100nF/50V` `4R7` `1%` `0R`
 */
export function isComponentParameterValue(value: string): boolean {
  const v = value.replace(/\s+/g, "");
  if (v === "") return false;
  // 纯数字(欧姆值常省略单位,如 510 / 270)
  if (/^\d+(\.\d+)?$/.test(v)) return true;
  // 数字 + SI 前缀 + 可选单位,可带 /耐压 或 ±容差
  if (/^\d+(\.\d+)?[pnuμµmkKMGRrΩ]?(R|Ω|OHM|F|H|HZ|V|A|W)?([/±,].*)?$/i.test(v)) return true;
  // 欧标写法:4R7 / 10K5 / 1M2
  if (/^\d+[RrKkMm]\d*$/.test(v)) return true;
  // 纯百分比/耐压等修饰
  if (/^[±]?\d+(\.\d+)?%$/.test(v)) return true;
  return false;
}

/**
 * Value 是否**看起来像**一个真实 MPN。
 *
 * 判据(全部满足):字母+数字混排、长度够、不是元件参数、不含下划线。
 * 下划线这条很关键:KiCad 的符号名大量使用下划线(`USB_B_Micro`、`Header_1x5`),
 * 而真实 MPN 几乎不含下划线 —— 这一条能干净地把符号名挡在外面。
 */
export function looksLikeMpn(value: string): boolean {
  const v = value.trim();
  if (v.length < 4 || v.length > 40) return false;
  if (v.includes("_")) return false;
  if (/\s/.test(v)) return false; // 带空格的多半是描述
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return false;
  if (isComponentParameterValue(v)) return false;
  return true;
}

export interface MpnInference {
  mpn: string;
  /** 0–1;仅用于排序与 UI 强弱提示,**不作为免确认的依据** */
  confidence: number;
  reason: string;
}

/** 不同器件类别下,从 Value 推断 MPN 的可信度 */
const CLASS_CONFIDENCE: Record<RefDesClass, number> = {
  active: 0.85, // U/IC/Q/D:Value 基本就是型号
  passive: 0.55, // R/C/L:Value 通常是参数,除非确实写了型号
  connector: 0.5, // J/P:多为 KiCad 符号名
  electromechanical: 0.5,
  unknown: 0.6,
};

/**
 * 从 Value 推断 MPN。判不准返回 null。
 *
 * **绝不**因为"这行没有 MPN"就硬凑一个 —— 宁可让它保持空白并提示人工补录。
 */
export function inferMpnFromValue(input: {
  value: string | null | undefined;
  refDes?: string | null;
}): MpnInference | null {
  const value = (input.value ?? "").trim();
  if (!value) return null;

  const cls = refDesClass(input.refDes);

  if (isComponentParameterValue(value)) {
    return null; // 参数就是参数,不是型号
  }
  if (!looksLikeMpn(value)) return null;

  const confidence = CLASS_CONFIDENCE[cls];
  const clsLabel: Record<RefDesClass, string> = {
    active: "有源器件",
    passive: "无源器件",
    connector: "连接器",
    electromechanical: "机电器件",
    unknown: "未知类别",
  };
  return {
    mpn: value,
    confidence,
    reason: `位号判定为${clsLabel[cls]},Value「${value}」形态符合厂商型号,已作为 MPN 候选(待人工确认)`,
  };
}

export interface KicadFootprint {
  /** 库名(冒号前),如 Capacitor_SMD */
  library: string | null;
  /** 封装全名(冒号后) */
  name: string;
  /** 归一后的封装代码,如 0603 / SOT-23-5 / QFN-32;取不出则为 null */
  packageCode: string | null;
}

/** 尺寸/工艺类后缀:出现即认为封装代码已经结束 */
const DIMENSION_SEGMENT =
  /^(\d+(\.\d+)?x\d+(\.\d+)?mm|P\d.*|EP\d.*|.*Metric|Vertical|Horizontal|Handsolder\w*|\d+(\.\d+)?mm)$/i;

/**
 * 器件类别前缀字母(C_0603 里的 C),单独成段时丢弃。
 * REF-2a:与 part-spec 合一(此前本处缺 CP/FL,`CP_Elec_6.3x5.4` 两处得到不同封装代码)。
 */
const CLASS_SEGMENT = KICAD_CLASS_SEGMENT;

/**
 * 解析 KiCad 封装串。
 * 例:`Capacitor_SMD:C_0603_1608Metric` → { library: "Capacitor_SMD", packageCode: "0603" }
 *     `Package_TO_SOT_SMD:SOT-23-5`    → packageCode "SOT-23-5"
 *     `Package_DFN_QFN:QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm` → "QFN-32"
 */
export function parseKicadFootprint(footprint: string | null | undefined): KicadFootprint | null {
  const raw = (footprint ?? "").trim();
  if (!raw) return null;

  const colon = raw.indexOf(":");
  const library = colon > 0 ? raw.slice(0, colon) : null;
  const name = (colon > 0 ? raw.slice(colon + 1) : raw).trim();
  if (!name) return null;

  const segments = name.split("_");
  const kept: string[] = [];
  for (const seg of segments) {
    if (DIMENSION_SEGMENT.test(seg)) break;
    if (kept.length === 0 && CLASS_SEGMENT.test(seg)) continue; // 丢掉 C_/R_ 这种类别前缀
    kept.push(seg);
  }

  let code = kept.join("_") || null;
  // QFN-32-1EP → QFN-32(-1EP 是散热焊盘标注,不属于封装代码)
  if (code) code = code.replace(/-\d*EP$/i, "");
  return { library, name, packageCode: code };
}
