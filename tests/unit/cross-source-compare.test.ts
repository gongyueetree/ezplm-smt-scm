import { describe, expect, it } from "vitest";
import { rankOffers } from "@/lib/domain/offers";
import { dedupeOffers } from "@/lib/providers/common/dedupe";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";
import { MockDigiKeyProvider } from "@/lib/providers/digikey";
import { MockMouserProvider } from "@/lib/providers/mouser";

/**
 * 同一 MPN 的跨源比价(SPEC §17 E2E 第 4 项的领域层验证)。
 * 线下供应商 Excel 报价(OFFLINE)与三方 API 报价共用 NormalizedOffer,
 * 证明"统一供应报价模型"确实能把四类来源放进同一张比价表。
 */
const MPN = "GRM188R71H104KA93D";

/** 线下供应商报价:PR6 由 Excel 导入产生,此处手工构造同构数据 */
const OFFLINE_OFFER: NormalizedOffer = {
  provider: "OFFLINE",
  providerPartNumber: "SH-MLCC-0603-104",
  manufacturer: "Murata",
  mpn: MPN,
  description: "线下代理商报价(Excel 导入)",
  packaging: "Tape & Reel",
  stock: 20000,
  moq: 1000,
  spq: 1000,
  leadTimeDays: 45,
  lifecycle: "ACTIVE",
  rohs: true,
  reach: true,
  currency: "CNY",
  priceBreaks: [{ minQty: 1000, unitPrice: "0.125" }],
  sourceUpdatedAt: "2026-07-26T09:00:00.000Z",
  sourceUrl: null,
  supplierId: "sup-offline-1",
  supplierPriority: 10,
};

async function collectOffers(): Promise<NormalizedOffer[]> {
  const [dk, mo] = await Promise.all([
    new MockDigiKeyProvider().getOffersByMpn({ mpn: MPN }),
    new MockMouserProvider().getOffersByMpn({ mpn: MPN }),
  ]);
  return dedupeOffers([...dk, ...mo, OFFLINE_OFFER]);
}

describe("跨源比价:DigiKey / Mouser / 线下 Excel 统一模型", () => {
  it("四条报价来自三种来源,去重后全部保留(不同 provider、不同包装各成一条)", async () => {
    const offers = await collectOffers();
    expect(offers).toHaveLength(4);
    expect(offers.filter((o) => o.provider === "DIGIKEY")).toHaveLength(2);
    expect(offers.filter((o) => o.provider === "MOUSER")).toHaveLength(1);
    expect(offers.filter((o) => o.provider === "OFFLINE")).toHaveLength(1);
  });

  it("需求 1000 时排名综合总价/交期/供应商优先级,而非只看最低总价", async () => {
    const ranked = rankOffers(await collectOffers(), { demandQty: 1000, currency: "CNY" });

    // 总价:线下 125 最低,但交期 45 天;DigiKey CT 总价 128、交期 21 天 → 综合更优
    const lowestTotal = ranked.find((r) => r.isLowestTotal)!;
    expect(lowestTotal.offer.provider).toBe("OFFLINE");
    expect(lowestTotal.extendedPrice!.toFixed()).toBe("125");
    expect(lowestTotal.rank).toBe(2);

    expect(ranked[0].offer.provider).toBe("DIGIKEY");
    expect(ranked[0].offer.packaging).toBe("Cut Tape (CT)");
    expect(ranked[0].extendedPrice!.toFixed()).toBe("128");

    expect(ranked.map((r) => `${r.offer.provider}:${r.offer.packaging}`)).toEqual([
      "DIGIKEY:Cut Tape (CT)",
      "OFFLINE:Tape & Reel",
      "MOUSER:Cut Tape",
      "DIGIKEY:Tape & Reel (TR)",
    ]);
  });

  it("整盘报价单价最低(0.0798/0.1085)却因 MOQ 4000 总价最高,排最后", async () => {
    const ranked = rankOffers(await collectOffers(), { demandQty: 1000, currency: "CNY" });
    const reel = ranked.find((r) => r.offer.packaging === "Tape & Reel (TR)")!;
    expect(reel.purchaseQty).toBe(4000);
    expect(reel.unitPrice!.toFixed()).toBe("0.1085");
    expect(reel.extendedPrice!.toFixed()).toBe("434");
    expect(reel.rank).toBe(4);
  });

  it("需求增大到 20000 时,整盘方案反超(排名随需求量变化)", async () => {
    const ranked = rankOffers(await collectOffers(), { demandQty: 20000, currency: "CNY" });
    expect(ranked[0].offer.packaging).toBe("Tape & Reel (TR)");
    expect(ranked[0].unitPrice!.toFixed()).toBe("0.0798");
    expect(ranked[0].extendedPrice!.toFixed()).toBe("1596");
    expect(ranked[0].isLowestTotal).toBe(true);
  });

  it("每条报价都带数据更新时间(诚实 UI:显示更新时间而非暗示实时)", async () => {
    for (const o of await collectOffers()) {
      expect(o.sourceUpdatedAt).toBeTruthy();
      expect(() => new Date(o.sourceUpdatedAt!).toISOString()).not.toThrow();
    }
  });
});
