/**
 * R0-8:统一的「这是不是一个可用价格」判定。
 *
 * 纪律来源:CLAUDE.md B5「单价无法解析的行跳过并回报原因,**绝不按 0 落库**」、
 * R4 §58「blank→0 禁止」。核心语义只有一句:**缺失 ≠ 0**。
 *
 * 之所以要抽成一处:审计发现这条纪律在四条路径上只接上了一条 ——
 * 供应商报价文件上传会拒 0,而 offer 批量导入判的是 `< 0`(0 合法)、
 * 价格池不查零值、比价总表把 0 当成真实报价并选成最低价、
 * 报价提交门禁判 `!== null`(存了 0.000000 照样过)。
 * 客户在前期版本上实际撞到的正是这一类:一行 $0.0000 被计入合计。
 *
 * 本模块是纯函数,不依赖 Prisma / Decimal 实例类型 —— 只要能 toString 就能判。
 *
 * **不适用于**:非价格的金额(如折扣额、调整额)可以合法为 0;
 * 本判定只用于「单价 / 采购成本」这类**必须为正**的场次。
 */

/** 为什么这个值不是可用价格 */
export type PriceRejectReason =
  /** 空、null、undefined、纯空白 */
  | "EMPTY"
  /** 有内容但解析不出有限数值 */
  | "UNPARSEABLE"
  /** 解析出来是 0 或负数 —— 典型的「缺失被当成 0」 */
  | "NON_POSITIVE";

export interface PriceCheckResult {
  ok: boolean;
  reason: PriceRejectReason | null;
  /** 可直接进 skipped/errors 的人读原因(含原值,便于对账) */
  message: string | null;
}

const OK: PriceCheckResult = { ok: true, reason: null, message: null };

/** 能 toString 的都收(string / number / Prisma Decimal / decimal.js) */
type PriceLike = string | number | { toString(): string } | null | undefined;

function rawText(v: PriceLike): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

/**
 * 判定一个价格值是否可用,并给出可直接落到 skipped/errors 的原因。
 * 解析口径:去掉千分位逗号与常见货币符号后按数值解析;不做单位换算、不猜。
 */
export function checkUsablePrice(value: PriceLike): PriceCheckResult {
  const raw = rawText(value).trim();
  if (raw === "") {
    return { ok: false, reason: "EMPTY", message: "单价缺失 —— 缺失不等于 0,不落库" };
  }
  const cleaned = raw.replace(/[,\s]/g, "").replace(/^[¥$€£]/, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "UNPARSEABLE", message: `单价无法解析:${raw}` };
  }
  if (n <= 0) {
    return { ok: false, reason: "NON_POSITIVE", message: `单价必须大于 0(读到 ${raw})` };
  }
  return OK;
}

/** 便捷判定:是否为可用价格 */
export function isUsablePrice(value: PriceLike): boolean {
  return checkUsablePrice(value).ok;
}

/**
 * 报价行是否已有**可用**的成本证据。
 * 与 `isUsablePrice` 同口径 —— 存进库的 `0.000000` 不算「已覆盖成本」,
 * 否则缺成本的行会静默通过报价提交门禁。
 */
export function hasUsableCost(purchaseCost: PriceLike): boolean {
  return isUsablePrice(purchaseCost);
}
