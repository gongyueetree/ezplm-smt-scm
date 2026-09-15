/**
 * R4-6(§30/§31/§40):供应商采购策略 + 推荐打分(纯函数)。
 *
 * 关系:Internal Material → (可选 MFG 件作用域) → Supplier。
 * 推荐 ≠ 采购决定(§40):打分只用于排序与说明,正式选择永远人工。
 */

export interface SupplierStrategyRow {
  supplierId: string;
  supplierName: string;
  /** 空 = Internal PN 级;非空 = 该 MFG 件专属策略(更具体,优先生效) */
  partMfgMappingId: string | null;
  priority: number;
  isPreferred: boolean;
  isApproved: boolean;
  isBlocked: boolean;
  moq: string | null;
  spq: string | null;
  leadTimeDays: number | null;
  allocationPercent: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  note: string | null;
}

/** 策略是否在有效期内(无起止 = 永续) */
export function strategyEffective(row: SupplierStrategyRow, now = new Date()): boolean {
  if (row.effectiveFrom && new Date(row.effectiveFrom) > now) return false;
  if (row.effectiveTo && new Date(row.effectiveTo) < now) return false;
  return true;
}

/**
 * 选取对某 MFG 件适用的策略集:
 * 该件专属策略 + Internal PN 级策略;同一供应商两级都有时**专属覆盖通用**。
 */
export function applicableStrategies(
  rows: SupplierStrategyRow[],
  partMfgMappingId: string | null,
  now = new Date(),
): SupplierStrategyRow[] {
  const effective = rows.filter((r) => strategyEffective(r, now));
  const specific = new Map(
    effective.filter((r) => r.partMfgMappingId && r.partMfgMappingId === partMfgMappingId).map((r) => [r.supplierId, r]),
  );
  const generic = effective.filter((r) => r.partMfgMappingId === null);
  const merged = new Map<string, SupplierStrategyRow>();
  for (const g of generic) merged.set(g.supplierId, g);
  for (const [sid, sp] of specific) merged.set(sid, sp);
  return [...merged.values()];
}

export interface SupplierPriceFact {
  supplierId: string;
  /** 该数量档的适用单价(已按 price basis 选档);无报价 = null */
  unitPrice: string | null;
  currency: string | null;
  /** 报价是否过期 */
  expired: boolean;
  /** 报价对该 MFG 件是否精确支持(quoted MPN 对齐) */
  exactMfgSupport: boolean;
  moq: string | null;
  leadTimeDays: number | null;
  /** 有历史成交(§40 Historical Relationship) */
  hasHistory: boolean;
}

export interface SupplierRecommendation {
  supplierId: string;
  supplierName: string;
  recommendationScore: number;
  recommendationReasons: string[];
  blocked: boolean;
}

/**
 * §40 推荐打分:Blocked 直接沉底(不进推荐);
 * Approved/Preferred/价格/MOQ/LT/有效性/历史/精确支持逐项累加并给出人话理由。
 * 分值只用于排序;**不做自动选择**。
 */
export function recommendSuppliers(
  strategies: SupplierStrategyRow[],
  facts: Map<string, SupplierPriceFact>,
  opts: { qty?: number } = {},
): SupplierRecommendation[] {
  void opts;
  const priced = [...facts.values()].filter((f) => f.unitPrice !== null && !f.expired);
  const minPrice = priced.length
    ? Math.min(...priced.map((f) => Number(f.unitPrice)))
    : null;

  const out: SupplierRecommendation[] = [];
  for (const s of strategies) {
    const f = facts.get(s.supplierId);
    const reasons: string[] = [];
    if (s.isBlocked) {
      out.push({
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        recommendationScore: 0,
        recommendationReasons: ["已拉黑(Blocked)—— 不参与推荐"],
        blocked: true,
      });
      continue;
    }
    let score = 0;
    if (s.isApproved) {
      score += 30;
      reasons.push("该内部料号的 Approved supplier");
    }
    if (s.isPreferred) {
      score += 15;
      reasons.push("Preferred(影响排序,不自动胜出)");
    }
    if (f?.exactMfgSupport) {
      score += 15;
      reasons.push("精确支持该 MFG 件");
    }
    if (f?.unitPrice && !f.expired) {
      score += 20;
      reasons.push(`适用单价 ${f.unitPrice}${f.currency ? ` ${f.currency}` : ""}`);
      if (minPrice !== null && Number(f.unitPrice) <= minPrice) {
        score += 10;
        reasons.push("当前数量档最低价");
      }
    } else if (f?.expired) {
      reasons.push("报价已过期(不计价格分)");
    } else {
      reasons.push("暂无可用报价");
    }
    const lt = f?.leadTimeDays ?? s.leadTimeDays;
    if (lt !== null && lt !== undefined) {
      score += Math.max(0, 10 - Math.min(10, Math.floor(lt / 7))); // LT 越短分越高
      reasons.push(`货期 ${lt} 天`);
    }
    const moq = f?.moq ?? s.moq;
    if (moq) reasons.push(`MOQ ${moq}`);
    if (f?.hasHistory) {
      score += 5;
      reasons.push("有历史成交关系");
    }
    // priority 数值越小越优:换算 0-5 分
    score += Math.max(0, 5 - Math.min(5, Math.floor(s.priority / 25)));

    out.push({
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      recommendationScore: score,
      recommendationReasons: reasons,
      blocked: false,
    });
  }
  return out.sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
    return b.recommendationScore - a.recommendationScore;
  });
}
