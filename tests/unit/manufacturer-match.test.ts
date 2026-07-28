import { describe, expect, it } from "vitest";
import { manufacturerAliases, manufacturerMatches } from "@/lib/providers/common/mpn";
import { rankOffers } from "@/lib/domain/offers";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";
import { MockMouserProvider } from "@/lib/providers/mouser";

/**
 * 制造商复核回归(PR4 联调冒烟发现:查 STM32F103C8T6 却有
 * "Microchip / Microsemi" 的记录进入排名)。
 *
 * 根因不是复核失效,而是:
 *   ① 调用方未传 manufacturer → provider 层按设计不过滤;
 *   ② 缺少「同 MPN 跨厂商不得同表比价」的上层护栏。
 * 两者分别由下面两组用例钉死。
 */

describe("manufacturerAliases:多制造商串拆分", () => {
  it("合并厂商名按分隔符拆成别名列表", () => {
    expect(manufacturerAliases("Microchip / Microsemi")).toEqual(["MICROCHIP", "MICROSEMI"]);
    expect(manufacturerAliases("AVX & Kyocera")).toEqual(["AVX", "KYOCERA"]);
    expect(manufacturerAliases("Vishay | Dale")).toEqual(["VISHAY", "DALE"]);
  });

  it("公司后缀被剥离,空值返回空列表", () => {
    expect(manufacturerAliases("Texas Instruments Inc.")).toEqual(["TEXAS INSTRUMENTS"]);
    expect(manufacturerAliases("YAGEO Corporation")).toEqual(["YAGEO"]);
    expect(manufacturerAliases(null)).toEqual([]);
    expect(manufacturerAliases("   ")).toEqual([]);
  });
});

describe("manufacturerMatches:合并厂商名与假阳性护栏", () => {
  it("合并厂商名的任一别名命中即匹配", () => {
    expect(manufacturerMatches("Microchip / Microsemi", "Microchip")).toBe(true);
    expect(manufacturerMatches("Microchip / Microsemi", "Microsemi")).toBe(true);
  });

  it("异厂商不得匹配 —— 冒烟中混入的正是这一类", () => {
    expect(manufacturerMatches("Microchip / Microsemi", "STMicroelectronics")).toBe(false);
    expect(manufacturerMatches("YAGEO", "Murata")).toBe(false);
    expect(manufacturerMatches("Analog Devices", "Texas Instruments")).toBe(false);
  });

  it("词序列前缀视为同厂(Murata ≡ Murata Electronics)", () => {
    expect(manufacturerMatches("Murata Electronics", "Murata")).toBe(true);
    expect(manufacturerMatches("Murata", "Murata Electronics")).toBe(true);
  });

  it("单词首段前缀需 ≥4 字符:STMICRO 匹配,两字母缩写 ST/TI 在本层不匹配(留给 PR5 别名表)", () => {
    expect(manufacturerMatches("STMicroelectronics", "STMicro")).toBe(true);
    expect(manufacturerMatches("STMicroelectronics", "ST")).toBe(false);
    expect(manufacturerMatches("Texas Instruments", "TI")).toBe(false);
  });

  it("query 为空 = 调用方未指定 = 不过滤(provider 层不替调用方臆断)", () => {
    expect(manufacturerMatches("Microchip / Microsemi", undefined)).toBe(true);
    expect(manufacturerMatches("任意厂商", "")).toBe(true);
  });

  it("actual 为空时,给定 query 一律不匹配(空值不当通配)", () => {
    expect(manufacturerMatches(null, "Murata")).toBe(false);
    expect(manufacturerMatches("", "Murata")).toBe(false);
  });
});

function offer(patch: Partial<NormalizedOffer>): NormalizedOffer {
  return {
    provider: "DIGIKEY",
    providerPartNumber: null,
    manufacturer: "STMicroelectronics",
    mpn: "STM32F103C8T6",
    description: null,
    packaging: null,
    stock: 5000,
    moq: 1,
    spq: 1,
    leadTimeDays: 30,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [{ minQty: 1, unitPrice: "20" }],
    sourceUpdatedAt: null,
    sourceUrl: null,
    ...patch,
  };
}

describe("同 MPN 跨厂商不得进入比价集合(rankOffers 护栏)", () => {
  const ctx = { demandQty: 1000, currency: "CNY", expectedManufacturer: "STMicroelectronics" };

  it("异厂商报价被标注 manufacturer_mismatch 且不参与可比排名", () => {
    const genuine = offer({ providerPartNumber: "REAL" });
    const wrongMfr = offer({
      providerPartNumber: "WRONG",
      manufacturer: "Microchip / Microsemi",
      provider: "MOUSER",
      priceBreaks: [{ minQty: 1, unitPrice: "4.12" }], // 更便宜,但不是同一颗料
    });

    const ranked = rankOffers([wrongMfr, genuine], ctx);
    expect(ranked[0].offer.providerPartNumber).toBe("REAL");
    expect(ranked[0].comparable).toBe(true);

    const rejected = ranked.find((r) => r.offer.providerPartNumber === "WRONG")!;
    expect(rejected.comparable).toBe(false);
    expect(rejected.incomparableReason).toBe("manufacturer_mismatch");
    // 关键:异厂低价不得抢走"最低总价"标记,也不得排在真品之前
    expect(rejected.isLowestTotal).toBe(false);
    expect(rejected.rank).toBeGreaterThan(ranked[0].rank);
  });

  it("同厂不同写法(Murata / Murata Electronics)仍视为可比", () => {
    const a = offer({ manufacturer: "Murata", providerPartNumber: "A" });
    const b = offer({ manufacturer: "Murata Electronics", providerPartNumber: "B" });
    const ranked = rankOffers([a, b], { ...ctx, expectedManufacturer: "Murata" });
    expect(ranked.every((r) => r.comparable)).toBe(true);
  });

  it("未设 expectedManufacturer 时不做制造商约束(保持既有行为)", () => {
    const wrongMfr = offer({ manufacturer: "Microchip / Microsemi" });
    const ranked = rankOffers([wrongMfr], { demandQty: 1000, currency: "CNY" });
    expect(ranked[0].comparable).toBe(true);
    expect(ranked[0].incomparableReason).toBeNull();
  });

  it("不可比原因按严重度取:异厂商优先于异币种", () => {
    const wrong = offer({ manufacturer: "Microchip / Microsemi", currency: "USD" });
    const ranked = rankOffers([wrong], ctx);
    expect(ranked[0].incomparableReason).toBe("manufacturer_mismatch");
  });
});

describe("Provider 层:传入制造商即拦截异厂结果", () => {
  it("显式传 manufacturer 时,异厂同号料被拦在 provider 层", async () => {
    const p = new MockMouserProvider();
    const withFilter = await p.getOffersByMpn({
      mpn: "STM32F103C8T6",
      manufacturer: "Microchip",
    });
    expect(withFilter).toEqual([]);

    const correct = await p.getOffersByMpn({
      mpn: "STM32F103C8T6",
      manufacturer: "STMicroelectronics",
    });
    expect(correct.length).toBeGreaterThan(0);
  });
});
