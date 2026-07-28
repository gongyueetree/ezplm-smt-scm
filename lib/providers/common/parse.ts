/**
 * 三方响应字段解析(纯函数,全部可单测)。
 *
 * 解析纪律(PR4 评审后固化):
 * 1. 语义判定禁止裸 includes/indexOf —— 子串匹配会把否定式误判为肯定式
 *    ("Inactive" 含 "active"、"REACH Unaffected" 含 "affected"、"Not In Production" 含 "production")。
 *    一律走「规范化 → 精确映射表 → 词边界规则 → 否定式护栏」。
 * 2. 否定式护栏优先级高于任何肯定式规则:凡出现 NOT / NO LONGER / OUT OF 等否定词而
 *    又无法精确归类者,一律返回 UNKNOWN / null,绝不落到"在产 / 合规 / 有货"。
 * 3. 解析不出来就返回 null(或 UNKNOWN),宁可标注未知,也不猜测数值与状态。
 */
import { Decimal } from "decimal.js";
import type { LifecycleValue } from "./normalized-offer";

/** 规范化:大写、非字母数字压成单空格、去首尾空白。"Non-RoHS" → "NON ROHS" */
export function normalizeText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z一-龥]+/g, " ")
    .trim();
}

/** JSON 数字/字符串 → 十进制字符串(非科学计数法);无效返回 null */
export function toDecimalString(value: unknown): string | null {
  if (value == null || value === "") return null;
  try {
    const d = new Decimal(typeof value === "number" ? String(value) : String(value).trim());
    if (!d.isFinite()) return null;
    return d.toFixed();
  } catch {
    return null;
  }
}

/**
 * 带货币符号/千分位的价格串 → 十进制字符串。
 * 支持 "¥1.23"、"$1,234.56"、"1,23 €"(逗号小数)、"1 234,56"。
 */
export function parseMoneyString(raw: unknown): string | null {
  if (typeof raw === "number") return toDecimalString(raw);
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    normalized = cleaned.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    normalized = /,\d{1,2}$/.test(cleaned)
      ? cleaned.replace(",", ".")
      : cleaned.split(",").join("");
  } else {
    normalized = cleaned;
  }
  return toDecimalString(normalized);
}

// ============================================================
// 库存数量
// ============================================================

/** 需人工询价的表述:不是数量,返回 null */
const QTY_INQUIRE = /\b(CALL|CONTACT|INQUIRE|QUOTE|TBD|NA|N A)\b/;
/** 明确无货:返回 0(比 null 更准确) */
const QTY_ZERO = /\b(NONE|NO STOCK|OUT OF STOCK|NOT IN STOCK)\b/;
/** 欠货/在途表述:其数字是"预计到货",不得计入现货库存 */
const QTY_BACKORDER = /\b(BACKORDER|BACK ORDER|ON ORDER|EXPECTED|DUE|LEAD TIME)\b/;
const QTY_IN_STOCK = /\bIN STOCK\b/;

/**
 * "500 In Stock" / "1,200" / 1200 → 数量。
 * "Backorder 5000 expected" → null(欠货不是现货);"None In Stock" → 0;
 * "Call for Availability" → null。
 */
export function parseQuantity(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
  if (typeof raw !== "string") return null;

  const compact = raw.replace(/,/g, ""); // 先去千分位,避免 "500,000" 被拆成 500
  const text = normalizeText(compact);
  if (!text) return null;
  if (QTY_ZERO.test(text)) return 0;
  if (QTY_INQUIRE.test(text)) return null;
  if (QTY_BACKORDER.test(text) && !QTY_IN_STOCK.test(text)) return null;

  const m = compact.match(/\d+/);
  return m ? Number(m[0]) : null;
}

// ============================================================
// 交期
// ============================================================

/** 区间取上界(保守,不低估交期):"1-2 Weeks" → 14 天 */
const LEAD_TIME_RE =
  /(\d+(?:\.\d+)?)(?:\s*[-–—~]\s*|\s+TO\s+)?(\d+(?:\.\d+)?)?\s*(WEEKS?|DAYS?|MONTHS?|周|天|月)?/;

/** "10 Weeks" / "14 Days" / "1-2 Weeks"(取上界) / "6周" → 天数;无法解析返回 null */
export function parseLeadTimeDays(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
  if (typeof raw !== "string") return null;

  const text = raw.toUpperCase().trim();
  const m = text.match(LEAD_TIME_RE);
  if (!m) return null;
  const lower = Number(m[1]);
  const upper = m[2] === undefined ? lower : Number(m[2]);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  const value = Math.max(lower, upper);

  const unit = m[3] ?? "";
  if (unit.startsWith("WEEK") || unit === "周") return Math.round(value * 7);
  if (unit.startsWith("MONTH") || unit === "月") return Math.round(value * 30);
  return Math.round(value);
}

// ============================================================
// 生命周期
// ============================================================

/** 精确映射表:规范化文本 → 枚举。各分销商的标准取值优先走这里 */
const LIFECYCLE_EXACT: Record<string, LifecycleValue> = {
  ACTIVE: "ACTIVE",
  PRODUCTION: "ACTIVE",
  "IN PRODUCTION": "ACTIVE",
  "NEW PRODUCT": "ACTIVE",
  PREPRODUCTION: "ACTIVE",
  "PRE PRODUCTION": "ACTIVE",
  NRND: "NRND",
  "NOT RECOMMENDED FOR NEW DESIGNS": "NRND",
  "NOT RECOMMENDED FOR NEW DESIGN": "NRND",
  "NOT FOR NEW DESIGNS": "NRND",
  "LAST TIME BUY": "NRND",
  LTB: "NRND",
  EOL: "EOL",
  "END OF LIFE": "EOL",
  DISCONTINUED: "EOL",
  "DISCONTINUED AT DIGI KEY": "EOL",
  OBSOLETE: "OBSOLETE",
  // Inactive:分销商用于"不再供应";按最保守处理为 OBSOLETE(排名最低),
  // 联调期若发现某源语义不同,以真实取值调整本表,而不是放宽规则。
  INACTIVE: "OBSOLETE",
};

/** 词边界规则(表未命中时);顺序即优先级,否定式护栏在肯定式之前 */
const LIFECYCLE_RULES: [RegExp, LifecycleValue][] = [
  [/\bOBSOLETE\b/, "OBSOLETE"],
  [/\bINACTIVE\b/, "OBSOLETE"],
  [/\bEND OF LIFE\b|\bEOL\b|\bDISCONTINUED\b/, "EOL"],
  [/\bNRND\b|\bNOT RECOMMENDED\b|\bNOT FOR NEW\b|\bLAST TIME BUY\b|\bLTB\b/, "NRND"],
  // 否定式护栏:出现否定词却无法精确归类 → UNKNOWN,绝不落 ACTIVE
  [/\bNOT\b|\bNO LONGER\b|\bOUT OF\b/, "UNKNOWN"],
  [/\bACTIVE\b|\bPRODUCTION\b|\bNEW PRODUCT\b/, "ACTIVE"],
];

/** 生命周期文本 → 枚举;未知一律 UNKNOWN(不猜测) */
export function parseLifecycle(raw: unknown): LifecycleValue {
  if (typeof raw !== "string") return "UNKNOWN";
  const text = normalizeText(raw);
  if (!text) return "UNKNOWN";
  const exact = LIFECYCLE_EXACT[text];
  if (exact) return exact;
  for (const [re, value] of LIFECYCLE_RULES) if (re.test(text)) return value;
  return "UNKNOWN";
}

// ============================================================
// 合规(RoHS / REACH)
// ============================================================

const COMPLIANCE_EXACT: Record<string, boolean | null> = {
  COMPLIANT: true,
  "ROHS COMPLIANT": true,
  "ROHS3 COMPLIANT": true,
  "ROHS 3 COMPLIANT": true,
  "ROHS COMPLIANT BY EXEMPTION": true,
  "ROHS EXEMPT": true,
  EXEMPT: true,
  "REACH UNAFFECTED": true,
  UNAFFECTED: true,
  "NOT COMPLIANT": false,
  "NON COMPLIANT": false,
  "NON ROHS": false,
  "ROHS NON COMPLIANT": false,
  "REACH AFFECTED": false,
  AFFECTED: false,
  UNKNOWN: null,
  UNDETERMINED: null,
  "NOT APPLICABLE": null,
  "NOT AVAILABLE": null,
  NA: null,
};

const COMPLIANCE_RULES: [RegExp, boolean | null][] = [
  [/\bUNKNOWN\b|\bUNDETERMINED\b|\bNOT APPLICABLE\b|\bNOT AVAILABLE\b/, null],
  // 肯定式的"UNAFFECTED"必须先于否定式的"AFFECTED"判定
  [/\bUNAFFECTED\b/, true],
  // 否定式护栏:NOT/NON 修饰合规词 → 不合规
  [/\b(NOT|NON)\b[\s\S]*\b(COMPLIANT|COMPLIANCE|ROHS|REACH)\b/, false],
  [/\bAFFECTED\b/, false],
  [/\bCOMPLIANT\b|\bCOMPLIANCE\b|\bEXEMPT\b/, true],
];

/** 合规状态文本 → true/false/null(未知不臆断) */
export function parseCompliance(raw: unknown): boolean | null {
  if (typeof raw !== "string") return null;
  const text = normalizeText(raw);
  if (!text) return null;
  if (text in COMPLIANCE_EXACT) return COMPLIANCE_EXACT[text];
  for (const [re, value] of COMPLIANCE_RULES) if (re.test(text)) return value;
  return null;
}
