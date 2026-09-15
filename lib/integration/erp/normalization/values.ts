/**
 * R4-1:值级归一化(纯函数)。
 * 铁律(§33/§34):blank → null;非空非法 → 报 issue;绝不 blank→0、绝不静默兜底。
 */
import type { SourceRowIssue } from "../canonical/types";

const BLANK = /^\s*$/;

/** decimal 字符串归一:blank→null;合法数值(允许千分位/负号)→ 规范串;非法→issue */
export function normalizeDecimal(
  raw: string | undefined,
  field: string,
  issues: SourceRowIssue[],
): string | null {
  if (raw === undefined || BLANK.test(raw)) return null;
  const cleaned = raw.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    issues.push({ code: "INVALID_DECIMAL", field, message: `非法数值「${raw.trim()}」` });
    return null;
  }
  return cleaned;
}

/**
 * 日期归一 → ISO 日期(yyyy-mm-dd)。支持金蝶导出常见形态:
 * yyyy-mm-dd / yyyy/m/d / yyyy-mm-dd HH:mm:ss / Excel 已被 cellText 转成 ISO 的值。
 */
export function normalizeDate(
  raw: string | undefined,
  field: string,
  issues: SourceRowIssue[],
): string | null {
  if (raw === undefined || BLANK.test(raw)) return null;
  const t = raw.trim();
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t);
  if (!m) {
    issues.push({ code: "INVALID_DATE", field, message: `非法日期「${t}」` });
    return null;
  }
  const [, y, mo, d] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(iso))) {
    issues.push({ code: "INVALID_DATE", field, message: `非法日期「${t}」` });
    return null;
  }
  return iso;
}

/** 布尔归一(金蝶导出:是/否、Y/N、启用/禁用);未知写法 → null(不猜) */
export function normalizeBoolean(raw: string | undefined): boolean | null {
  if (raw === undefined || BLANK.test(raw)) return null;
  const t = raw.trim();
  if (/^(是|Y|YES|TRUE|启用|已启用)$/i.test(t)) return true;
  if (/^(否|N|NO|FALSE|禁用|未启用|未禁用)$/i.test(t)) return false;
  // 「禁用状态」列常见值:未禁用=false 已处理;其余原样不猜
  return null;
}

/** 文本归一:trim;空 → null */
export function normalizeText(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

/** 必填文本:空 → MISSING_REQUIRED issue + null */
export function requireText(
  raw: string | undefined,
  field: string,
  issues: SourceRowIssue[],
): string | null {
  const t = normalizeText(raw);
  if (t === null) issues.push({ code: "MISSING_REQUIRED", field, message: "必填字段为空" });
  return t;
}

/** 垃圾占位值(#N、N/A、0、-、无)→ null;非垃圾原样保留 */
const JUNK = /^(#N\/?A?|N\/?A|NA|0|-+|无|\/|—)$/i;
export function normalizeJunkText(raw: string | undefined): string | null {
  const t = normalizeText(raw);
  if (t === null || JUNK.test(t)) return null;
  return t;
}
