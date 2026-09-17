/**
 * R4-6(§39/§44/§26 v2-§45/§46 定义前置):统一 Material Price Pool(纯函数)。
 *
 * 不建平行数据库总表 —— 聚合既有 SupplierOffer/PriceBreak/历史采购/内部价/
 * DigiKey/Mouser 为统一逻辑 DTO NormalizedMaterialPrice。
 * 所有价格必须携带 来源/时间/币种/适用数量/有效期(§39);
 * Lowest/Highest 定义(§26 v2):当前 Price Qty Basis 下"有效且可使用"候选的
 * 最低/最高单价;排除 过期/被拒/Blocked 供应商/币种非法/数量不适用。
 */
import { isUsablePrice } from "./price-guard";

export type PriceSource =
  | "INTERNAL"
  | "HISTORICAL_PO"
  | "SUPPLIER_QUOTE"
  | "CONTRACT"
  | "DIGIKEY"
  | "MOUSER"
  | "MANUAL";

export interface NormalizedMaterialPrice {
  source: PriceSource;
  supplierId: string | null;
  provider: string | null;
  partId: string | null;
  partMfgMappingId: string | null;
  internalPn: string | null;
  canonicalManufacturerId: string | null;
  manufacturer: string | null;
  mpn: string | null;
  currency: string;
  /** decimal 字符串;禁止 JS float */
  unitPrice: string;
  minQty: string;
  maxQty: string | null;
  moq: string | null;
  spq: string | null;
  leadTimeDays: number | null;
  quotedAt: string | null;
  validUntil: string | null;
  sourceUpdatedAt: string | null;
  /** 证据指针:SupplierOffer id / PO 单号 / provider offer id … */
  evidenceRef: string;
  /** 供应商报价的审批态(§37):非 APPROVED 引用须标 UNAPPROVED_SOURCE */
  approvalStatus: "APPROVED" | "RECEIVED" | "REVIEWED" | "REJECTED" | "EXPIRED" | null;
}

export type PriceFreshness = "CURRENT" | "STALE" | "EXPIRED";

/** §31 v1:不同来源的 freshness 口径不同;stale 阈值按来源给 */
export function priceFreshness(p: NormalizedMaterialPrice, now = new Date()): PriceFreshness {
  if (p.validUntil && new Date(p.validUntil) < now) return "EXPIRED";
  const ts = p.quotedAt ?? p.sourceUpdatedAt;
  if (!ts) return "STALE";
  const ageDays = (now.getTime() - new Date(ts).getTime()) / 86_400_000;
  const staleAfter =
    p.source === "DIGIKEY" || p.source === "MOUSER"
      ? 7 // 分销商价按抓取时间,一周即陈旧
      : p.source === "HISTORICAL_PO"
        ? 180 // 历史采购价:半年内算"近期成交"
        : 90; // 供应商报价/内部价
  return ageDays > staleAfter ? "STALE" : "CURRENT";
}

export interface UsableFilterInput {
  qty: number;
  blockedSupplierIds?: ReadonlySet<string>;
  /** 报价系统基准币种;null = 不校验币种 */
  allowedCurrencies?: ReadonlySet<string> | null;
  now?: Date;
}

export interface PriceExclusion {
  price: NormalizedMaterialPrice;
  reason:
    | "EXPIRED"
    | "REJECTED"
    | "BLOCKED_SUPPLIER"
    | "INVALID_CURRENCY"
    | "QTY_NOT_APPLICABLE"
    /** R0-8:0 或负价 —— 缺失被当成 0 的典型,绝不能参与「最低价」 */
    | "NON_POSITIVE_PRICE";
}

/**
 * §26 v2:筛出"有效且可使用"的候选。返回可用集与逐条排除原因(可解释)。
 * 数量适用:minQty ≤ qty 且(maxQty 为空或 qty ≤ maxQty)。
 * 注意:同一来源多档阶梯应**先选档再进池**(每候选一条适用档)。
 */
export function usablePrices(
  prices: NormalizedMaterialPrice[],
  input: UsableFilterInput,
): { usable: NormalizedMaterialPrice[]; excluded: PriceExclusion[] } {
  const now = input.now ?? new Date();
  const usable: NormalizedMaterialPrice[] = [];
  const excluded: PriceExclusion[] = [];
  for (const p of prices) {
    // R0-8:先判价格本身是否可用 —— 0/负/不可解析一律出池。
    // priceRange 用裸 Number() 比大小,放 0 进来会直接把「最低价」变成 0 元。
    if (!isUsablePrice(p.unitPrice)) {
      excluded.push({ price: p, reason: "NON_POSITIVE_PRICE" });
      continue;
    }
    if (p.approvalStatus === "REJECTED") {
      excluded.push({ price: p, reason: "REJECTED" });
      continue;
    }
    if (priceFreshness(p, now) === "EXPIRED" || p.approvalStatus === "EXPIRED") {
      excluded.push({ price: p, reason: "EXPIRED" });
      continue;
    }
    if (p.supplierId && input.blockedSupplierIds?.has(p.supplierId)) {
      excluded.push({ price: p, reason: "BLOCKED_SUPPLIER" });
      continue;
    }
    if (input.allowedCurrencies && !input.allowedCurrencies.has(p.currency)) {
      excluded.push({ price: p, reason: "INVALID_CURRENCY" });
      continue;
    }
    const min = Number(p.minQty);
    const max = p.maxQty === null ? Infinity : Number(p.maxQty);
    if (!(input.qty >= min && input.qty <= max)) {
      excluded.push({ price: p, reason: "QTY_NOT_APPLICABLE" });
      continue;
    }
    usable.push(p);
  }
  return { usable, excluded };
}

export interface PriceRange {
  low: NormalizedMaterialPrice | null;
  high: NormalizedMaterialPrice | null;
  supplierOnlyLow: NormalizedMaterialPrice | null;
  supplierOnlyHigh: NormalizedMaterialPrice | null;
}

const SUPPLIER_SOURCES: ReadonlySet<PriceSource> = new Set(["SUPPLIER_QUOTE", "CONTRACT"]);
const DISTRIBUTOR_SOURCES: ReadonlySet<PriceSource> = new Set(["DIGIKEY", "MOUSER"]);

/**
 * §26 v2:Low/High —— Supplier-only 与 Overall 双口径;
 * Distributor 是否进 Overall 由租户配置 includeDistributorInPriceRange 决定。
 * 前提:调用方已用 usablePrices 过滤;跨币种比较由调用方先 FX 归一(§27 v2)。
 */
export function priceRange(
  usable: NormalizedMaterialPrice[],
  opts: { includeDistributorInRange: boolean },
): PriceRange {
  const overallSet = usable.filter(
    (p) => opts.includeDistributorInRange || !DISTRIBUTOR_SOURCES.has(p.source),
  );
  const supplierSet = usable.filter((p) => SUPPLIER_SOURCES.has(p.source));
  const lowOf = (list: NormalizedMaterialPrice[]) =>
    list.length ? list.reduce((a, b) => (Number(b.unitPrice) < Number(a.unitPrice) ? b : a)) : null;
  const highOf = (list: NormalizedMaterialPrice[]) =>
    list.length ? list.reduce((a, b) => (Number(b.unitPrice) > Number(a.unitPrice) ? b : a)) : null;
  return {
    low: lowOf(overallSet),
    high: highOf(overallSet),
    supplierOnlyLow: lowOf(supplierSet),
    supplierOnlyHigh: highOf(supplierSet),
  };
}

/**
 * §44:Price Qty Basis —— Selected Buy Qty > Suggested Buy Qty > Demand Qty。
 * 返回所选数量与依据标签(落库/快照必须保存 PRICE_QTY_BASIS)。
 */
export function priceQtyBasis(input: {
  selectedBuyQty?: number | null;
  suggestedBuyQty?: number | null;
  demandQty: number;
}): { qty: number; basis: "SELECTED_BUY_QTY" | "SUGGESTED_BUY_QTY" | "DEMAND_QTY" } {
  if (input.selectedBuyQty != null && input.selectedBuyQty > 0) {
    return { qty: input.selectedBuyQty, basis: "SELECTED_BUY_QTY" };
  }
  if (input.suggestedBuyQty != null && input.suggestedBuyQty > 0) {
    return { qty: input.suggestedBuyQty, basis: "SUGGESTED_BUY_QTY" };
  }
  return { qty: input.demandQty, basis: "DEMAND_QTY" };
}
