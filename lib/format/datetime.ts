/**
 * 面向用户展示的日期时间格式化(纯函数)。
 *
 * 为什么需要这一层:原来各页面直接写
 * `d.toISOString().slice(0, 16).replace("T", " ")`。
 * `toISOString()` 永远返回 **UTC** —— 客户在 UTC+8,于是每一个
 * 「创建时间 / 导入时间 / 更新时间」都比真实时刻**早 8 小时**。
 * 客户在 PR2 试用反馈里直接报了这个问题(PM-4「导入 BOM 的时间和实际导入时间不匹配」)。
 *
 * 服务端渲染的组件不能靠浏览器本地时区 —— 容器时区通常是 UTC,
 * 而且同一份页面对所有人应当一致。所以时区是**部署期配置**,
 * 由 `APP_TIMEZONE` 指定,默认 `Asia/Shanghai`(甲方在苏州)。
 *
 * 纪律:
 * - 展示用一律走本模块,**不再手写 toISOString().slice**;
 * - 机器可读的场合(幂等键、文件名、审计 before/after、ERP 导出字段)
 *   继续用 ISO/UTC —— 那些不是给人看的,换成本地时区反而会引入歧义;
 * - 空值返回调用方给的占位符,**绝不返回 1970-01-01 之类的假时刻**。
 */

/** 部署期时区。甲方在苏州,默认 Asia/Shanghai */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Shanghai";

type DateLike = Date | string | number | null | undefined;

function toDate(v: DateLike): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 取指定时区下的年月日时分秒。
 *
 * 用 `Intl.DateTimeFormat` 的 `timeZone` 而不是手工加 8 小时:
 * 手工偏移在跨夏令时的时区上必错,而且把"配置成别的时区"这条路堵死了。
 */
function partsIn(date: Date, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  // Intl 在部分实现上把午夜的小时给成 "24",归一到 "00"
  if (out.hour === "24") out.hour = "00";
  return out;
}

/** `YYYY-MM-DD`(按 APP_TIMEZONE) */
export function formatDate(v: DateLike, fallback = "-", timeZone = APP_TIMEZONE): string {
  const d = toDate(v);
  if (!d) return fallback;
  const p = partsIn(d, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `YYYY-MM-DD HH:mm`(按 APP_TIMEZONE) */
export function formatDateTime(v: DateLike, fallback = "-", timeZone = APP_TIMEZONE): string {
  const d = toDate(v);
  if (!d) return fallback;
  const p = partsIn(d, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** `YYYY-MM-DD HH:mm:ss`(按 APP_TIMEZONE)—— 日志类需要到秒 */
export function formatDateTimeSeconds(
  v: DateLike,
  fallback = "-",
  timeZone = APP_TIMEZONE,
): string {
  const d = toDate(v);
  if (!d) return fallback;
  const p = partsIn(d, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * 供 `<input type="date">` 使用的值。
 *
 * 与 formatDate 同为 `YYYY-MM-DD`,单独给个名字是为了让调用点自解释:
 * 表单默认值必须和用户在页面上看到的日期一致,否则打开编辑框会"跳一天"。
 */
export const formatDateInputValue = formatDate;
