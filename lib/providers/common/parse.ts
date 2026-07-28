/**
 * 三方响应字段解析(纯函数,全部可单测)。
 * 解析失败一律返回 null —— 宁可标注「未知」,也不猜测数值(诚实纪律)。
 */
import { Decimal } from "decimal.js";
import type { LifecycleValue } from "./normalized-offer";

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
    // 两者皆有:靠后的是小数点,另一个是千分位
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    normalized = cleaned.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // 只有逗号:末尾两位小数视为小数点,否则视为千分位
    normalized = /,\d{1,2}$/.test(cleaned)
      ? cleaned.replace(",", ".")
      : cleaned.split(",").join("");
  } else {
    normalized = cleaned;
  }
  return toDecimalString(normalized);
}

/** "500 In Stock" / "1,200" / 1200 → 1200;无法解析返回 null */
export function parseQuantity(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
  if (typeof raw !== "string") return null;
  const m = raw.replace(/,/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** "10 Weeks" / "14 Days" / "10" → 天数;无法解析返回 null */
export function parseLeadTimeDays(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/(\d+(?:\.\d+)?)\s*(week|weeks|day|days|月|周|天)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit.startsWith("week") || unit === "周") return Math.round(n * 7);
  if (unit === "月") return Math.round(n * 30);
  return Math.round(n);
}

/** 生命周期文本 → 枚举;未知一律 UNKNOWN(不猜测) */
export function parseLifecycle(raw: unknown): LifecycleValue {
  if (typeof raw !== "string") return "UNKNOWN";
  const s = raw.toLowerCase();
  if (s.includes("obsolete")) return "OBSOLETE";
  if (s.includes("end of life") || s.includes("discontinued") || s.includes("eol")) return "EOL";
  if (s.includes("not for new design") || s.includes("nrnd") || s.includes("last time buy")) {
    return "NRND";
  }
  if (s.includes("active") || s.includes("production") || s.includes("new product")) return "ACTIVE";
  return "UNKNOWN";
}

/** 合规状态文本 → true/false/null(未知不臆断) */
export function parseCompliance(raw: unknown): boolean | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().trim();
  if (s === "" || s.includes("unknown") || s.includes("undetermined")) return null;
  // 判定顺序要紧:"unaffected" 含子串 "affected","not compliant" 含子串 "compliant",
  // 肯定式必须先于其对应的否定式子串匹配,否则会把合规误判为不合规。
  if (s.includes("unaffected")) return true;
  if (s.includes("not compliant") || s.includes("non-compliant") || s.includes("noncompliant")) {
    return false;
  }
  if (s.includes("affected")) return false;
  if (s.includes("compliant") || s.includes("exempt")) return true;
  return null;
}
