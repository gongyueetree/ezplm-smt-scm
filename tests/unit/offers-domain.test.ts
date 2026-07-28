import { describe, expect, it } from "vitest";
import {
  Decimal,
  calculateExtendedPrice,
  calculateRoundedPurchaseQty,
  evaluateOffer,
  getApplicablePriceBreak,
  rankOffers,
  roundMoney,
} from "@/lib/domain/offers";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";

const BREAKS = [
  { minQty: 1, unitPrice: "0.72" },
  { minQty: 100, unitPrice: "0.31" },
  { minQty: 1000, unitPrice: "0.128" },
  { minQty: 10000, unitPrice: "0.0865" },
];

function offer(patch: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    provider: "DIGIKEY",
    providerPartNumber: "dk-1",
    manufacturer: "Murata",
    mpn: "GRM188R71H104KA93D",
    description: null,
    packaging: null,
    stock: 100000,
    moq: 1,
    spq: 1,
    leadTimeDays: 21,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: BREAKS,
    sourceUpdatedAt: "2026-07-27T02:00:00.000Z",
    sourceUrl: null,
    ...patch,
  };
}

describe("getApplicablePriceBreak(SPEC §17:价格阶梯选择)", () => {
  it("取 minQty <= qty 中最大的一档", () => {
    expect(getApplicablePriceBreak(BREAKS, 1)?.unitPrice).toBe("0.72");
    expect(getApplicablePriceBreak(BREAKS, 99)?.unitPrice).toBe("0.72");
    expect(getApplicablePriceBreak(BREAKS, 100)?.unitPrice).toBe("0.31");
    expect(getApplicablePriceBreak(BREAKS, 999)?.unitPrice).toBe("0.31");
    expect(getApplicablePriceBreak(BREAKS, 1000)?.unitPrice).toBe("0.128");
    expect(getApplicablePriceBreak(BREAKS, 250000)?.unitPrice).toBe("0.0865");
  });

  it("阶梯乱序不影响选择结果", () => {
    const shuffled = [BREAKS[2], BREAKS[0], BREAKS[3], BREAKS[1]];
    expect(getApplicablePriceBreak(shuffled, 1000)?.unitPrice).toBe("0.128");
  });

  it("数量低于最低阶梯 → null(必须先做 MOQ/SPQ 圆整再取价)", () => {
    expect(getApplicablePriceBreak([{ minQty: 4000, unitPrice: "0.1" }], 1000)).toBeNull();
  });

  it("空阶梯、零或负数量 → null", () => {
    expect(getApplicablePriceBreak([], 100)).toBeNull();
    expect(getApplicablePriceBreak(BREAKS, 0)).toBeNull();
    expect(getApplicablePriceBreak(BREAKS, -5)).toBeNull();
  });
});

describe("calculateRoundedPurchaseQty(SPEC §17:MOQ/SPQ 圆整)", () => {
  it("先不低于 MOQ,再按 SPQ 向上圆整", () => {
    expect(calculateRoundedPurchaseQty(1000, { moq: 4000, spq: 4000 })).toBe(4000);
    expect(calculateRoundedPurchaseQty(4001, { moq: 4000, spq: 4000 })).toBe(8000);
    expect(calculateRoundedPurchaseQty(120, { moq: 1, spq: 50 })).toBe(150);
    expect(calculateRoundedPurchaseQty(150, { moq: 1, spq: 50 })).toBe(150);
  });

  it("无 MOQ/SPQ 时按需求向上取整", () => {
    expect(calculateRoundedPurchaseQty(37)).toBe(37);
    expect(calculateRoundedPurchaseQty(36.2)).toBe(37);
  });

  it("需求 <= 0 → 0(不产生采购)", () => {
    expect(calculateRoundedPurchaseQty(0, { moq: 100 })).toBe(0);
    expect(calculateRoundedPurchaseQty(-10, { moq: 100 })).toBe(0);
  });

  it("圆整结果恒不低于 MOQ", () => {
    for (const [demand, moq, spq] of [
      [1, 500, 300],
      [499, 500, 7],
      [501, 500, 250],
    ] as const) {
      expect(calculateRoundedPurchaseQty(demand, { moq, spq })).toBeGreaterThanOrEqual(moq);
    }
  });

  it("MOQ/SPQ 为 0 或 null 视为无约束", () => {
    expect(calculateRoundedPurchaseQty(100, { moq: 0, spq: 0 })).toBe(100);
    expect(calculateRoundedPurchaseQty(100, { moq: null, spq: null })).toBe(100);
  });
});

describe("calculateExtendedPrice / roundMoney(禁止浮点误差)", () => {
  it("小数单价 × 大数量不产生浮点误差", () => {
    // 0.1 + 0.2 类浮点问题在金额上必须不出现
    expect(calculateExtendedPrice("0.0865", 250000).toFixed()).toBe("21625");
    expect(calculateExtendedPrice("0.1", 3).toFixed()).toBe("0.3");
    expect(new Decimal("0.1").plus("0.2").toFixed()).toBe("0.3");
  });

  it("全精度不中途舍入;展示层按币种舍入", () => {
    const total = calculateExtendedPrice("0.128", 1000);
    expect(total.toFixed()).toBe("128");
    expect(roundMoney(calculateExtendedPrice("0.1085", 4001)).toFixed(2)).toBe("434.11");
  });
});

describe("rankOffers(SPEC §10:不能只看最低单价)", () => {
  const ctx = { demandQty: 1000, currency: "CNY" };

  it("最低单价但 MOQ 抬高总价者,不得排第一", () => {
    const cutTape = offer({ providerPartNumber: "CT", priceBreaks: BREAKS });
    const reel = offer({
      providerPartNumber: "TR",
      moq: 4000,
      spq: 4000,
      priceBreaks: [
        { minQty: 4000, unitPrice: "0.1085" }, // 单价更低
        { minQty: 20000, unitPrice: "0.0798" },
      ],
    });
    const ranked = rankOffers([reel, cutTape], ctx);
    expect(ranked[0].offer.providerPartNumber).toBe("CT");
    // 单价:CT 0.128 > TR 0.1085,但总价 CT 128 < TR 434
    expect(ranked[0].unitPrice!.toFixed()).toBe("0.128");
    expect(ranked[0].extendedPrice!.toFixed()).toBe("128");
    expect(ranked[1].extendedPrice!.toFixed()).toBe("434");
    expect(ranked[0].isLowestTotal).toBe(true);
  });

  it("同价时 EOL/停产排在 ACTIVE 之后", () => {
    const active = offer({ providerPartNumber: "A", lifecycle: "ACTIVE" });
    const eol = offer({ providerPartNumber: "B", lifecycle: "EOL" });
    const ranked = rankOffers([eol, active], ctx);
    expect(ranked[0].offer.providerPartNumber).toBe("A");
    expect(ranked[0].score.lifecycle).toBeGreaterThan(ranked[1].score.lifecycle);
  });

  it("同价同生命周期时,库存不足者排后", () => {
    const inStock = offer({ providerPartNumber: "A", stock: 100000 });
    const short = offer({ providerPartNumber: "B", stock: 300 });
    const ranked = rankOffers([short, inStock], ctx);
    expect(ranked[0].offer.providerPartNumber).toBe("A");
    expect(ranked[0].stockCovered).toBe(true);
    expect(ranked[1].stockCovered).toBe(false);
    expect(ranked[1].stockCoverage).toBeCloseTo(0.3, 6);
  });

  it("同价同库存时,交期短者优先", () => {
    const fast = offer({ providerPartNumber: "A", leadTimeDays: 7 });
    const slow = offer({ providerPartNumber: "B", leadTimeDays: 84 });
    const ranked = rankOffers([slow, fast], ctx);
    expect(ranked[0].offer.providerPartNumber).toBe("A");
  });

  it("其余条件相同时,供应商优先级(数值小)胜出", () => {
    const preferred = offer({ providerPartNumber: "A", supplierPriority: 10 });
    const other = offer({ providerPartNumber: "B", supplierPriority: 200 });
    const ranked = rankOffers([other, preferred], ctx);
    expect(ranked[0].offer.providerPartNumber).toBe("A");
  });

  it("异币种报价不参与可比排名,但保留并标注原因(不静默丢弃)", () => {
    const cny = offer({ providerPartNumber: "CNY" });
    const usd = offer({ providerPartNumber: "USD", currency: "USD" });
    const ranked = rankOffers([usd, cny], ctx);
    expect(ranked[0].offer.providerPartNumber).toBe("CNY");
    expect(ranked[1].comparable).toBe(false);
    expect(ranked[1].incomparableReason).toBe("currency_mismatch");
    expect(ranked).toHaveLength(2);
  });

  it("圆整后仍取不到阶梯价者标记 no_price_break 并排在可比报价之后", () => {
    const ok = offer({ providerPartNumber: "A" });
    const noPrice = offer({ providerPartNumber: "B", priceBreaks: [] });
    const ranked = rankOffers([noPrice, ok], ctx);
    expect(ranked[0].offer.providerPartNumber).toBe("A");
    expect(ranked[1].incomparableReason).toBe("no_price_break");
    expect(ranked[1].extendedPrice).toBeNull();
  });

  it("排名确定:输入顺序不影响结果", () => {
    const a = offer({ providerPartNumber: "A", leadTimeDays: 21 });
    const b = offer({ providerPartNumber: "B", leadTimeDays: 30 });
    const c = offer({ providerPartNumber: "C", lifecycle: "NRND" });
    const first = rankOffers([a, b, c], ctx).map((r) => r.offer.providerPartNumber);
    const second = rankOffers([c, b, a], ctx).map((r) => r.offer.providerPartNumber);
    const third = rankOffers([b, a, c], ctx).map((r) => r.offer.providerPartNumber);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("rank 连续编号且评分明细完整", () => {
    const ranked = rankOffers([offer({ providerPartNumber: "A" }), offer({ providerPartNumber: "B" })], ctx);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
    for (const r of ranked) {
      expect(Object.keys(r.score).sort()).toEqual(
        ["availability", "leadTime", "lifecycle", "price", "supplier", "total"].sort(),
      );
      expect(r.score.total).toBeGreaterThan(0);
      expect(r.score.total).toBeLessThanOrEqual(1);
    }
  });

  it("空输入返回空数组", () => {
    expect(rankOffers([], ctx)).toEqual([]);
  });
});

describe("evaluateOffer(排名的确定性输入)", () => {
  it("按 MOQ/SPQ 圆整后取价并计算总价", () => {
    const e = evaluateOffer(
      offer({ moq: 4000, spq: 4000, priceBreaks: [{ minQty: 4000, unitPrice: "0.1085" }] }),
      { demandQty: 1000, currency: "CNY" },
    );
    expect(e.purchaseQty).toBe(4000);
    expect(e.unitPrice!.toFixed()).toBe("0.1085");
    expect(e.extendedPrice!.toFixed()).toBe("434");
    expect(e.comparable).toBe(true);
  });

  it("库存未知按 0 计,不臆断可供", () => {
    const e = evaluateOffer(offer({ stock: null }), { demandQty: 100, currency: "CNY" });
    expect(e.stockCovered).toBe(false);
    expect(e.stockCoverage).toBe(0);
  });
});
