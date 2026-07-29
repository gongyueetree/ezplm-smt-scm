import { describe, expect, it } from "vitest";
import { availabilityLabel, bestPriceAtQty, summarizeMarket } from "@/lib/domain/market-summary";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";

function offer(over: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    provider: "DIGIKEY",
    providerPartNumber: "X",
    manufacturer: "ST",
    mpn: "STM32F103C8T6",
    description: null,
    packaging: null,
    stock: 1000,
    moq: 1,
    spq: 1,
    leadTimeDays: 30,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [
      { minQty: 1, unitPrice: "7.45" },
      { minQty: 100, unitPrice: "4.84" },
    ],
    sourceUpdatedAt: "2026-07-29T04:15:00.000Z",
    sourceUrl: null,
    ...over,
  };
}

describe("availabilityLabel:阈值相对需求量,不是绝对值", () => {
  it("库存 5000 对样品单是充足,对 10 万台量产是紧张", () => {
    expect(availabilityLabel(5000, 1)).toBe("充足");
    expect(availabilityLabel(5000, 100_000)).toBe("紧张");
  });

  it("按倍数分档", () => {
    expect(availabilityLabel(1000, 100)).toBe("充足"); // ≥10×
    expect(availabilityLabel(300, 100)).toBe("一般"); // ≥2×
    expect(availabilityLabel(120, 100)).toBe("紧张");
  });

  it("0 是无现货", () => {
    expect(availabilityLabel(0)).toBe("无现货");
  });

  it("**未知不能显示成无货**", () => {
    expect(availabilityLabel(null)).toBe("未知");
  });
});

describe("bestPriceAtQty:取适用阶梯的最低价", () => {
  it("按数量取对应阶梯", () => {
    expect(bestPriceAtQty([offer()], 1)?.unitPrice).toBe("7.45");
    expect(bestPriceAtQty([offer()], 100)?.unitPrice).toBe("4.84");
    expect(bestPriceAtQty([offer()], 500)?.unitPrice).toBe("4.84");
  });

  it("同币种内取更低的一家", () => {
    const cheap = offer({ provider: "MOUSER", priceBreaks: [{ minQty: 1, unitPrice: "6.00" }] });
    expect(bestPriceAtQty([offer(), cheap], 1)?.provider).toBe("MOUSER");
  });

  it("零价/非法价不参与,不会被当成最低价", () => {
    const zero = offer({ provider: "MOUSER", priceBreaks: [{ minQty: 1, unitPrice: "0" }] });
    expect(bestPriceAtQty([offer(), zero], 1)?.provider).toBe("DIGIKEY");
  });

  it("无阶梯价时返回 null", () => {
    expect(bestPriceAtQty([offer({ priceBreaks: [] })], 1)).toBeNull();
  });
});

describe("summarizeMarket", () => {
  it("汇总阶梯价、库存、渠道与数据时间", () => {
    const m = summarizeMarket([offer(), offer({ provider: "MOUSER", stock: 500 })]);
    expect(m.tiers.map((t) => t.qty)).toEqual([1, 100]);
    expect(m.totalStock).toBe(1500);
    expect(m.channels.sort()).toEqual(["DIGIKEY", "MOUSER"]);
    expect(m.dataUpdatedAt).toBe("2026-07-29T04:15:00.000Z");
    expect(m.availability).toBe("充足");
  });

  it("**异币种要标注**,提示不可直接比较(系统不做汇率换算)", () => {
    const m = summarizeMarket([offer(), offer({ provider: "MOUSER", currency: "USD" })]);
    expect(m.mixedCurrency).toBe(true);
  });

  it("库存全未知时 totalStock 为 null 且供货判为未知", () => {
    const m = summarizeMarket([offer({ stock: null }), offer({ provider: "MOUSER", stock: null })]);
    expect(m.totalStock).toBeNull();
    expect(m.availability).toBe("未知");
    expect(m.channels).toEqual([]);
  });

  it("空报价不报错", () => {
    const m = summarizeMarket([]);
    expect(m.tiers).toEqual([]);
    expect(m.availability).toBe("未知");
    expect(m.dataUpdatedAt).toBeNull();
  });
});
