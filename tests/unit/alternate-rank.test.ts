import { describe, expect, it } from "vitest";
import {
  needsAlternate,
  priceScores,
  rankAlternates,
  type AlternateCandidate,
} from "@/lib/domain/alternate-rank";

function cand(over: Partial<AlternateCandidate> & { mpn: string }): AlternateCandidate {
  return {
    manufacturer: null,
    origin: "DIGIKEY",
    similarity: 0.8,
    lifecycle: "ACTIVE",
    stock: 1000,
    unitPrice: "1.00",
    currency: "CNY",
    footprintMatches: true,
    ...over,
  };
}

describe("needsAlternate:什么时候该找替代", () => {
  it("没匹配上 → 需要", () => {
    expect(needsAlternate({ matched: false, lifecycle: null }).needed).toBe(true);
  });

  it("停产 / NRND → 需要,并说明原因", () => {
    expect(needsAlternate({ matched: true, lifecycle: "EOL" })).toMatchObject({ needed: true });
    expect(needsAlternate({ matched: true, lifecycle: "OBSOLETE" }).needed).toBe(true);
    expect(needsAlternate({ matched: true, lifecycle: "NRND" }).reason).toContain("NRND");
  });

  it("在产且已匹配 → 不需要", () => {
    expect(needsAlternate({ matched: true, lifecycle: "ACTIVE" })).toEqual({
      needed: false,
      reason: null,
    });
  });
});

describe("priceScores:同币种内相对比价", () => {
  it("最低价 1 分,两倍价 0.5 分", () => {
    const s = priceScores([
      cand({ mpn: "A", unitPrice: "1.00" }),
      cand({ mpn: "B", unitPrice: "2.00" }),
    ]);
    expect(s.get("A")).toBe(1);
    expect(s.get("B")).toBe(0.5);
  });

  it("**异币种各自成组** —— 系统不做汇率换算", () => {
    const s = priceScores([
      cand({ mpn: "A", unitPrice: "10", currency: "CNY" }),
      cand({ mpn: "B", unitPrice: "2", currency: "USD" }),
    ]);
    expect(s.get("A")).toBe(1); // CNY 组里它最低
    expect(s.get("B")).toBe(1); // USD 组里它最低
  });

  it("无价 / 非法价 / 零价不参与,不会被当成 0 元", () => {
    const s = priceScores([
      cand({ mpn: "A", unitPrice: null }),
      cand({ mpn: "B", unitPrice: "abc" }),
      cand({ mpn: "C", unitPrice: "0" }),
    ]);
    expect(s.size).toBe(0);
  });
});

describe("rankAlternates:优先级 本系统 > 有现货 > 性价比", () => {
  it("**本系统物料库排在外部源前面**(同等条件)", () => {
    const r = rankAlternates([
      cand({ mpn: "EXT", origin: "DIGIKEY" }),
      cand({ mpn: "OWN", origin: "LOCAL" }),
    ]);
    expect(r[0].candidate.mpn).toBe("OWN");
    expect(r[0].reasons.join()).toContain("本系统物料库已有");
    expect(r[0].readyToOrder).toBe(true);
    expect(r[0].reasons.join()).toContain("可直接下单");
  });

  it("有现货的排在无现货前面", () => {
    const r = rankAlternates([
      cand({ mpn: "NOSTOCK", stock: 0 }),
      cand({ mpn: "INSTOCK", stock: 5000 }),
    ]);
    expect(r[0].candidate.mpn).toBe("INSTOCK");
    expect(r.find((x) => x.candidate.mpn === "NOSTOCK")!.reasons).toContain("无现货");
  });

  it("**库存未知不等于没货**,给中性分而不是垫底", () => {
    const r = rankAlternates([
      cand({ mpn: "ZERO", stock: 0 }),
      cand({ mpn: "UNKNOWN_STOCK", stock: null }),
    ]);
    expect(r[0].candidate.mpn).toBe("UNKNOWN_STOCK");
    expect(r[0].reasons).toContain("库存未知");
  });

  it("停产件即使有货也不排前面 —— 拿停产件当替代等于没解决问题", () => {
    const r = rankAlternates([
      cand({ mpn: "EOL_INSTOCK", lifecycle: "EOL", stock: 99999, unitPrice: "0.10" }),
      cand({ mpn: "ACTIVE_LESS", lifecycle: "ACTIVE", stock: 100, unitPrice: "2.00" }),
    ]);
    expect(r[0].candidate.mpn).toBe("ACTIVE_LESS");
    expect(r.find((x) => x.candidate.mpn === "EOL_INSTOCK")!.reasons.join()).toContain("已停产");
  });

  it("其它条件相同时,单价低的排前面", () => {
    const r = rankAlternates([
      cand({ mpn: "PRICEY", unitPrice: "10.00" }),
      cand({ mpn: "CHEAP", unitPrice: "1.00" }),
    ]);
    expect(r[0].candidate.mpn).toBe("CHEAP");
  });

  it("相似度权重最高 —— 便宜又有货但根本不像的料不是替代料", () => {
    const r = rankAlternates([
      cand({ mpn: "UNRELATED", similarity: 0.1, unitPrice: "0.01", stock: 99999 }),
      cand({ mpn: "SIMILAR", similarity: 0.95, unitPrice: "5.00", stock: 10 }),
    ]);
    expect(r[0].candidate.mpn).toBe("SIMILAR");
  });

  it("封装不同要写明需工程确认,不能默默当等价", () => {
    const r = rankAlternates([cand({ mpn: "A", footprintMatches: false })]);
    expect(r[0].reasons.join()).toContain("封装不同");
  });

  it("limit 生效;同分时按 MPN 稳定排序", () => {
    const list = [cand({ mpn: "B" }), cand({ mpn: "A" }), cand({ mpn: "C" })];
    const r1 = rankAlternates(list, { limit: 2 });
    const r2 = rankAlternates([...list].reverse(), { limit: 2 });
    expect(r1).toHaveLength(2);
    expect(r1.map((x) => x.candidate.mpn)).toEqual(r2.map((x) => x.candidate.mpn));
  });
});

describe("措辞纪律:库存未知时不敢说「可直接下单」", () => {
  it("自家料但库存未知 → 只说「已有」,不说能下单", () => {
    const r = rankAlternates([cand({ mpn: "OWN", origin: "LOCAL", stock: null })]);
    expect(r[0].readyToOrder).toBe(false);
    expect(r[0].reasons.join()).toContain("本系统物料库已有");
    expect(r[0].reasons.join()).not.toContain("可直接下单");
  });
});
