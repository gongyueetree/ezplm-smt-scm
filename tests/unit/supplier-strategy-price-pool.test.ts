/**
 * R4-6(§40/§44/§26v2/§55):策略推荐 + 价格池纯函数矩阵。
 */
import { describe, expect, it } from "vitest";
import {
  applicableStrategies,
  recommendSuppliers,
  strategyEffective,
  type SupplierPriceFact,
  type SupplierStrategyRow,
} from "@/lib/domain/supplier-strategy";
import {
  priceFreshness,
  priceQtyBasis,
  priceRange,
  usablePrices,
  type NormalizedMaterialPrice,
} from "@/lib/domain/price-pool";

const strat = (over: Partial<SupplierStrategyRow> & Pick<SupplierStrategyRow, "supplierId">): SupplierStrategyRow => ({
  supplierName: over.supplierId,
  partMfgMappingId: null,
  priority: 100,
  isPreferred: false,
  isApproved: false,
  isBlocked: false,
  moq: null,
  spq: null,
  leadTimeDays: null,
  allocationPercent: null,
  effectiveFrom: null,
  effectiveTo: null,
  note: null,
  ...over,
});

const price = (over: Partial<NormalizedMaterialPrice>): NormalizedMaterialPrice => ({
  source: "SUPPLIER_QUOTE",
  supplierId: "s1",
  provider: null,
  partId: "p1",
  partMfgMappingId: null,
  internalPn: "PN-1",
  canonicalManufacturerId: null,
  manufacturer: null,
  mpn: "MPN-1",
  currency: "CNY",
  unitPrice: "1.30",
  minQty: "500",
  maxQty: null,
  moq: "500",
  spq: null,
  leadTimeDays: 7,
  quotedAt: new Date().toISOString(),
  validUntil: null,
  sourceUpdatedAt: null,
  evidenceRef: "test",
  approvalStatus: "APPROVED",
  ...over,
});

describe("§31 策略作用域与有效期", () => {
  it("件级策略覆盖同供应商的料级策略;有效期过滤(§55-37/38)", () => {
    const rows = [
      strat({ supplierId: "s1", priority: 50 }),
      strat({ supplierId: "s1", partMfgMappingId: "m1", priority: 10 }),
      strat({ supplierId: "s2" }),
      strat({ supplierId: "s3", effectiveTo: "2020-01-01" }), // 已失效
    ];
    const forM1 = applicableStrategies(rows, "m1");
    expect(forM1.find((r) => r.supplierId === "s1")?.priority).toBe(10); // 件级覆盖
    expect(forM1.some((r) => r.supplierId === "s3")).toBe(false);
    const generic = applicableStrategies(rows, null);
    expect(generic.find((r) => r.supplierId === "s1")?.priority).toBe(50);
    expect(strategyEffective(rows[3])).toBe(false);
  });
});

describe("§40 推荐(§55-35/36)", () => {
  const facts = new Map<string, SupplierPriceFact>([
    ["s1", { supplierId: "s1", unitPrice: "1.30", currency: "CNY", expired: false, exactMfgSupport: true, moq: "500", leadTimeDays: 7, hasHistory: true }],
    ["s2", { supplierId: "s2", unitPrice: "1.10", currency: "CNY", expired: false, exactMfgSupport: false, moq: null, leadTimeDays: 30, hasHistory: false }],
    ["s3", { supplierId: "s3", unitPrice: "0.90", currency: "CNY", expired: false, exactMfgSupport: false, moq: null, leadTimeDays: 7, hasHistory: false }],
  ]);

  it("Blocked 供应商沉底且零分(§55-35);不是 ORDER BY price 单因子", () => {
    const recs = recommendSuppliers(
      [strat({ supplierId: "s1", isApproved: true, isPreferred: true }), strat({ supplierId: "s2" }), strat({ supplierId: "s3", isBlocked: true })],
      facts,
    );
    const s3 = recs.find((r) => r.supplierId === "s3")!;
    expect(s3.blocked).toBe(true);
    expect(s3.recommendationScore).toBe(0);
    expect(recs[recs.length - 1].supplierId).toBe("s3"); // 沉底
    // s3 最便宜但被拉黑;s1 贵但 Approved+Preferred+精确支持+历史 → 排第一
    expect(recs[0].supplierId).toBe("s1");
    expect(recs[0].recommendationReasons.join()).toContain("Approved");
  });

  it("Preferred 影响排序但不自动胜出(§55-36):价格与其它因子可反超", () => {
    const recs = recommendSuppliers(
      [strat({ supplierId: "s1", isPreferred: true }), strat({ supplierId: "s2", isApproved: true })],
      new Map([
        ["s1", { supplierId: "s1", unitPrice: "5.00", currency: "CNY", expired: true, exactMfgSupport: false, moq: null, leadTimeDays: 60, hasHistory: false }],
        ["s2", { supplierId: "s2", unitPrice: "1.00", currency: "CNY", expired: false, exactMfgSupport: true, moq: null, leadTimeDays: 5, hasHistory: true }],
      ]),
    );
    expect(recs[0].supplierId).toBe("s2"); // Approved+价格+LT+精确支持 > 仅 Preferred(过期报价)
    expect(recs.find((r) => r.supplierId === "s1")!.recommendationReasons.join()).toContain("过期");
  });
});

describe("§44 数量依据 + §26v2 可用集/Low/High(§55 多项)", () => {
  it("Price Qty Basis:Selected > Suggested > Demand,保存依据标签", () => {
    expect(priceQtyBasis({ demandQty: 800 })).toEqual({ qty: 800, basis: "DEMAND_QTY" });
    expect(priceQtyBasis({ demandQty: 800, suggestedBuyQty: 1000 })).toEqual({ qty: 1000, basis: "SUGGESTED_BUY_QTY" });
    expect(priceQtyBasis({ demandQty: 800, suggestedBuyQty: 1000, selectedBuyQty: 1500 })).toEqual({ qty: 1500, basis: "SELECTED_BUY_QTY" });
  });

  it("排除矩阵:过期/拒绝/拉黑/币种/数量不适用,各给原因(§26v2)", () => {
    const prices = [
      price({ evidenceRef: "ok" }),
      price({ evidenceRef: "expired", validUntil: "2020-01-01T00:00:00Z" }),
      price({ evidenceRef: "rejected", approvalStatus: "REJECTED" }),
      price({ evidenceRef: "blocked", supplierId: "bad" }),
      price({ evidenceRef: "usd", currency: "USD" }),
      price({ evidenceRef: "qty", minQty: "5000" }),
    ];
    const { usable, excluded } = usablePrices(prices, {
      qty: 800,
      blockedSupplierIds: new Set(["bad"]),
      allowedCurrencies: new Set(["CNY"]),
    });
    expect(usable.map((p) => p.evidenceRef)).toEqual(["ok"]);
    expect(new Map(excluded.map((e) => [e.price.evidenceRef, e.reason]))).toEqual(
      new Map([
        ["expired", "EXPIRED"],
        ["rejected", "REJECTED"],
        ["blocked", "BLOCKED_SUPPLIER"],
        ["usd", "INVALID_CURRENCY"],
        ["qty", "QTY_NOT_APPLICABLE"],
      ]),
    );
  });

  it("Low/High:Supplier-only 与 Overall 双口径;分销商是否进 Overall 由配置定(§26v2)", () => {
    const prices = [
      price({ evidenceRef: "sq-low", unitPrice: "1.20" }),
      price({ evidenceRef: "sq-high", unitPrice: "1.50", supplierId: "s2" }),
      price({ evidenceRef: "dk", source: "DIGIKEY", supplierId: null, unitPrice: "0.95" }),
    ];
    const withDist = priceRange(prices, { includeDistributorInRange: true });
    expect(withDist.low?.evidenceRef).toBe("dk");
    expect(withDist.supplierOnlyLow?.evidenceRef).toBe("sq-low");
    expect(withDist.supplierOnlyHigh?.evidenceRef).toBe("sq-high");
    const noDist = priceRange(prices, { includeDistributorInRange: false });
    expect(noDist.low?.evidenceRef).toBe("sq-low");
    expect(noDist.high?.evidenceRef).toBe("sq-high");
  });

  it("freshness 按来源口径:分销商 7 天即 STALE;历史采购 180 天;有效期优先", () => {
    const old10d = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(priceFreshness(price({ source: "DIGIKEY", quotedAt: old10d }))).toBe("STALE");
    expect(priceFreshness(price({ source: "HISTORICAL_PO", quotedAt: old10d }))).toBe("CURRENT");
    expect(priceFreshness(price({ validUntil: "2020-01-01T00:00:00Z" }))).toBe("EXPIRED");
  });
});

describe("R0-8 价格池:0 价不得可用、更不得成为最低价", () => {
  it("unitPrice = 0 被排除,原因是 NON_POSITIVE_PRICE", () => {
    const { usable, excluded } = usablePrices(
      [price({ unitPrice: "0", minQty: "1" }), price({ unitPrice: "1.30", minQty: "1" })],
      { qty: 10 },
    );
    expect(usable).toHaveLength(1);
    expect(usable[0].unitPrice).toBe("1.30");
    expect(excluded.map((e) => e.reason)).toContain("NON_POSITIVE_PRICE");
  });

  it("0.000000 与负价同样被排除", () => {
    const { usable } = usablePrices(
      [price({ unitPrice: "0.000000", minQty: "1" }), price({ unitPrice: "-2", minQty: "1" })],
      { qty: 10 },
    );
    expect(usable).toHaveLength(0);
  });

  it("priceRange 拿不到 0 价 —— 最低价必须是真实报价", () => {
    const { usable } = usablePrices(
      [price({ unitPrice: "0", minQty: "1" }), price({ unitPrice: "9.50", minQty: "1" })],
      { qty: 10 },
    );
    const r = priceRange(usable, { includeDistributorInRange: true });
    expect(r.low?.unitPrice).toBe("9.50");
  });
});

describe("R0-7 线下报价同权进池(决策已定,实施在 REF-3)", () => {
  /*
   * 决策记录见 docs/refactor/CUSTOMER_FEEDBACK_2026-09-17.md §3:
   * 线下 / 人工录入的报价必须与 API 报价**同权参与比价**。
   *
   * 现状缺口:通用 Excel 录入落 SupplierQuote + SupplierQuoteLine(单价、无阶梯),
   * 而价格池只读 SupplierOffer + PriceBreak —— 走哪条通道录入,
   * 决定了这个价格会不会参与比价。
   *
   * 这里**不写假的红灯**(常红的用例会瘫痪 CI,也会教人忽略红色)。
   * 用 todo 如实登记待办:它会出现在测试输出里,REF-3 实施时替换为真实断言。
   */
  it.todo("SupplierQuoteLine 经 mapper 进入 NormalizedMaterialPrice,与 SupplierOffer 同权参与 priceRange");
  it.todo("单一价格以 minQty = moq ?? 1 表示成一档阶梯(沿用 supplier-action 既有先例)");
  it.todo("线下报价必有 validUntil,过期自动失效且不参与比价");
});
