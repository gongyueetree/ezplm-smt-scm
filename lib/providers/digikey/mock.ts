/**
 * MockDigiKeyProvider:无凭据时的开发实现(SPEC §8 纪律:不得伪造"已联调")。
 * 样例 MPN 与 ezPLM Mock 保持一致,便于跨源比价的确定性测试。
 */
import type {
  DistributorProvider,
  GetOffersInput,
  OfferCandidate,
  SearchCandidatesInput,
} from "../common/distributor";
import { manufacturerMatches, mpnEquals, normalizeMpn } from "../common/mpn";
import type { NormalizedOffer } from "../common/normalized-offer";

const T0 = "2026-07-27T02:00:00.000Z";

const OFFERS: NormalizedOffer[] = [
  {
    provider: "DIGIKEY",
    providerPartNumber: "497-6063-ND",
    manufacturer: "STMicroelectronics",
    mpn: "STM32F103C8T6",
    description: "MCU ARM Cortex-M3 64KB Flash LQFP-48",
    packaging: "Tray",
    stock: 5200,
    moq: 1,
    spq: 1,
    leadTimeDays: 56,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [
      { minQty: 1, unitPrice: "28.6" },
      { minQty: 10, unitPrice: "25.4" },
      { minQty: 100, unitPrice: "22.15" },
      { minQty: 1000, unitPrice: "19.8" },
    ],
    sourceUpdatedAt: T0,
    sourceUrl: "https://www.digikey.cn/product-detail/497-6063-ND",
    supplierPriority: 20,
  },
  {
    provider: "DIGIKEY",
    providerPartNumber: "490-1532-1-ND",
    manufacturer: "Murata",
    mpn: "GRM188R71H104KA93D",
    description: "CAP CER 0.1uF 50V X7R 0603",
    packaging: "Cut Tape (CT)",
    stock: 240000,
    moq: 1,
    spq: 1,
    leadTimeDays: 21,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [
      { minQty: 1, unitPrice: "0.72" },
      { minQty: 100, unitPrice: "0.31" },
      { minQty: 1000, unitPrice: "0.128" },
      { minQty: 10000, unitPrice: "0.0865" },
    ],
    sourceUpdatedAt: T0,
    sourceUrl: "https://www.digikey.cn/product-detail/490-1532-1-ND",
    supplierPriority: 20,
  },
  {
    provider: "DIGIKEY",
    providerPartNumber: "490-1532-2-ND",
    manufacturer: "Murata",
    mpn: "GRM188R71H104KA93D",
    description: "CAP CER 0.1uF 50V X7R 0603(整盘)",
    packaging: "Tape & Reel (TR)",
    stock: 200000,
    moq: 4000,
    spq: 4000,
    leadTimeDays: 21,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [
      { minQty: 4000, unitPrice: "0.1085" },
      { minQty: 20000, unitPrice: "0.0798" },
    ],
    sourceUpdatedAt: T0,
    sourceUrl: "https://www.digikey.cn/product-detail/490-1532-2-ND",
    supplierPriority: 20,
  },
  {
    provider: "DIGIKEY",
    providerPartNumber: "MAX232CPE+-ND",
    manufacturer: "Analog Devices",
    mpn: "MAX232CPE",
    description: "RS-232 收发器 DIP-16(停产)",
    packaging: "Tube",
    stock: 12,
    moq: 1,
    spq: 1,
    leadTimeDays: null,
    lifecycle: "EOL",
    rohs: false,
    reach: null,
    currency: "CNY",
    priceBreaks: [{ minQty: 1, unitPrice: "62.5" }],
    sourceUpdatedAt: T0,
    sourceUrl: "https://www.digikey.cn/product-detail/MAX232CPE",
    supplierPriority: 20,
  },
  {
    provider: "DIGIKEY",
    providerPartNumber: "296-19095-1-ND",
    manufacturer: "Texas Instruments",
    mpn: "MAX3232EIDR",
    description: "RS-232 收发器 3-5.5V SOIC-16",
    packaging: "Cut Tape (CT)",
    stock: 18000,
    moq: 1,
    spq: 1,
    leadTimeDays: 35,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [
      { minQty: 1, unitPrice: "13.2" },
      { minQty: 100, unitPrice: "9.85" },
      { minQty: 1000, unitPrice: "7.6" },
    ],
    sourceUpdatedAt: T0,
    sourceUrl: "https://www.digikey.cn/product-detail/296-19095-1-ND",
    supplierPriority: 20,
  },
];

const SUBSTITUTES: Record<string, string[]> = {
  MAX232CPE: ["MAX3232EIDR"],
};

const RECOMMENDED: Record<string, string[]> = {
  STM32F103C8T6: ["STM32F103CBT6"],
};

export class MockDigiKeyProvider implements DistributorProvider {
  readonly name = "DIGIKEY" as const;

  async getOffersByMpn(input: GetOffersInput): Promise<NormalizedOffer[]> {
    return OFFERS.filter(
      (o) =>
        mpnEquals(o.mpn, input.mpn) && manufacturerMatches(o.manufacturer, input.manufacturer),
    );
  }

  async searchCandidates(input: SearchCandidatesInput): Promise<OfferCandidate[]> {
    const kw = normalizeMpn(input.keyword) || input.keyword.toUpperCase();
    const seen = new Set<string>();
    return OFFERS.filter((o) => {
      const hay = `${normalizeMpn(o.mpn)} ${(o.description ?? "").toUpperCase()}`;
      return hay.includes(kw);
    })
      .filter((o) => (seen.has(o.mpn) ? false : (seen.add(o.mpn), true)))
      .slice(0, Math.min(input.limit ?? 20, 50))
      .map((o) => ({
        provider: "DIGIKEY" as const,
        providerPartNumber: o.providerPartNumber,
        mpn: o.mpn,
        manufacturer: o.manufacturer,
        description: o.description,
        sourceUrl: o.sourceUrl,
      }));
  }

  async getSubstitutes(mpn: string): Promise<OfferCandidate[]> {
    return this.candidatesFor(SUBSTITUTES[normalizeMpn(mpn)] ?? []);
  }

  async getRecommended(mpn: string): Promise<OfferCandidate[]> {
    return this.candidatesFor(RECOMMENDED[normalizeMpn(mpn)] ?? []);
  }

  private candidatesFor(mpns: string[]): OfferCandidate[] {
    return mpns.map((m) => {
      const hit = OFFERS.find((o) => mpnEquals(o.mpn, m));
      return {
        provider: "DIGIKEY" as const,
        providerPartNumber: hit?.providerPartNumber ?? null,
        mpn: m,
        manufacturer: hit?.manufacturer ?? null,
        description: hit?.description ?? null,
        sourceUrl: hit?.sourceUrl ?? null,
      };
    });
  }
}

export const MOCK_DIGIKEY_OFFERS = OFFERS;
