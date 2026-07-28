/**
 * DistributorProvider 合同断言集:Mock 与 Http 实现共用,保证行为同构。
 * 断言的是「接口行为与数据契约」,不是具体价格数值(各源报价本就不同)。
 */
import { describe, expect, it } from "vitest";
import type { DistributorProvider } from "@/lib/providers/common/distributor";
import { NormalizedOfferSchema } from "@/lib/providers/common/normalized-offer";
import { normalizeMpn } from "@/lib/providers/common/mpn";

export interface DistributorContractFixtures {
  /** 该实现一定能查到报价的 MPN */
  knownMpn: string;
  knownManufacturer: string;
  /** 关键字检索一定有结果的词 */
  keyword: string;
  /** 该实现一定查不到的 MPN */
  unknownMpn?: string;
}

export function runDistributorContract(
  name: string,
  makeProvider: () => Promise<DistributorProvider> | DistributorProvider,
  fx: DistributorContractFixtures,
) {
  const unknownMpn = fx.unknownMpn ?? "NO-SUCH-MPN-ZZZ-999";

  describe(`DistributorProvider 合同:${name}`, () => {
    it("getOffersByMpn 返回符合 NormalizedOffer 契约的报价", async () => {
      const p = await makeProvider();
      const offers = await p.getOffersByMpn({ mpn: fx.knownMpn });
      expect(offers.length).toBeGreaterThan(0);
      for (const o of offers) {
        expect(() => NormalizedOfferSchema.parse(o)).not.toThrow();
        expect(normalizeMpn(o.mpn)).toBe(normalizeMpn(fx.knownMpn));
        expect(o.provider).toBe(p.name);
        expect(o.currency).toMatch(/^[A-Z]{3}$/);
      }
    });

    it("阶梯价按 minQty 升序,单价为十进制字符串", async () => {
      const p = await makeProvider();
      const offers = await p.getOffersByMpn({ mpn: fx.knownMpn });
      const withBreaks = offers.filter((o) => o.priceBreaks.length > 0);
      expect(withBreaks.length).toBeGreaterThan(0);
      for (const o of withBreaks) {
        const qtys = o.priceBreaks.map((b) => b.minQty);
        expect(qtys).toEqual([...qtys].sort((a, b) => a - b));
        for (const b of o.priceBreaks) expect(b.unitPrice).toMatch(/^-?\d+(\.\d+)?$/);
      }
    });

    it("制造商过滤生效", async () => {
      const p = await makeProvider();
      const hit = await p.getOffersByMpn({ mpn: fx.knownMpn, manufacturer: fx.knownManufacturer });
      expect(hit.length).toBeGreaterThan(0);
      const miss = await p.getOffersByMpn({ mpn: fx.knownMpn, manufacturer: "NoSuchMfg-ZZZ" });
      expect(miss).toEqual([]);
    });

    it("未知 MPN 返回空数组(不抛错、不阻断整单)", async () => {
      const p = await makeProvider();
      expect(await p.getOffersByMpn({ mpn: unknownMpn })).toEqual([]);
    });

    it("searchCandidates 只返回候选:结构上不含价格/库存字段(SPEC §8 纪律)", async () => {
      const p = await makeProvider();
      const candidates = await p.searchCandidates({ keyword: fx.keyword });
      expect(candidates.length).toBeGreaterThan(0);
      const allowed = [
        "provider",
        "providerPartNumber",
        "mpn",
        "manufacturer",
        "description",
        "sourceUrl",
      ].sort();
      for (const c of candidates) {
        expect(Object.keys(c).sort()).toEqual(allowed);
        expect(c.provider).toBe(p.name);
        expect(typeof c.mpn).toBe("string");
      }
    });

    it("searchCandidates 的 limit 生效且不超过 50(SPEC §9 上限)", async () => {
      const p = await makeProvider();
      expect((await p.searchCandidates({ keyword: fx.keyword, limit: 1 })).length).toBeLessThanOrEqual(1);
      expect((await p.searchCandidates({ keyword: fx.keyword, limit: 999 })).length).toBeLessThanOrEqual(50);
    });

    it("getSubstitutes / getRecommended 恒返回数组(不支持时为空,不伪造)", async () => {
      const p = await makeProvider();
      expect(Array.isArray(await p.getSubstitutes(fx.knownMpn))).toBe(true);
      expect(Array.isArray(await p.getRecommended(fx.knownMpn))).toBe(true);
    });
  });
}
