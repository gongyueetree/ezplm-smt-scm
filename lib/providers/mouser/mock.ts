/**
 * MockMouserProvider:无 Key 时的开发实现(不得伪造"已联调")。
 * 样例 MPN 与 ezPLM / DigiKey Mock 一致,便于跨源比价的确定性测试。
 */
import type {
  DistributorProvider,
  GetOffersInput,
  OfferCandidate,
  SearchCandidatesInput,
} from "../common/distributor";
import { manufacturerMatches, mpnEquals, normalizeMpn } from "../common/mpn";
import type { NormalizedOffer } from "../common/normalized-offer";
import { MOUSER_MAX_RECORDS } from "./provider";

const T0 = "2026-07-27T01:30:00.000Z";

const OFFERS: NormalizedOffer[] = [
  {
    provider: "MOUSER",
    providerPartNumber: "511-STM32F103C8T6",
    manufacturer: "STMicroelectronics",
    mpn: "STM32F103C8T6",
    description: "ARM Microcontrollers - MCU 32BIT Cortex M3 64KB",
    packaging: "Tray",
    stock: 3100,
    moq: 1,
    spq: 1,
    leadTimeDays: 42,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [
      { minQty: 1, unitPrice: "27.9" },
      { minQty: 10, unitPrice: "24.8" },
      { minQty: 100, unitPrice: "21.6" },
      { minQty: 1000, unitPrice: "20.4" },
    ],
    sourceUpdatedAt: T0,
    sourceUrl: "https://www.mouser.cn/ProductDetail/511-STM32F103C8T6",
    supplierPriority: 25,
  },
  {
    provider: "MOUSER",
    providerPartNumber: "81-GRM188R71H104KA3D",
    manufacturer: "Murata Electronics",
    mpn: "GRM188R71H104KA93D",
    description: "Multilayer Ceramic Capacitors MLCC 0.1uF 50V X7R 0603",
    packaging: "Cut Tape",
    stock: 150000,
    moq: 1,
    spq: 1,
    leadTimeDays: 28,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [
      { minQty: 1, unitPrice: "0.69" },
      { minQty: 100, unitPrice: "0.295" },
      { minQty: 1000, unitPrice: "0.134" },
      { minQty: 10000, unitPrice: "0.0902" },
    ],
    sourceUpdatedAt: T0,
    sourceUrl: "https://www.mouser.cn/ProductDetail/81-GRM188R71H104KA3D",
    supplierPriority: 25,
  },
  {
    provider: "MOUSER",
    providerPartNumber: "595-MAX3232EIDR",
    manufacturer: "Texas Instruments",
    mpn: "MAX3232EIDR",
    description: "RS-232 Interface IC 3-5.5V Multichannel RS-232 Line Driver/Receiver",
    packaging: "Cut Tape",
    stock: 9600,
    moq: 1,
    spq: 1,
    leadTimeDays: 30,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [
      { minQty: 1, unitPrice: "12.9" },
      { minQty: 100, unitPrice: "10.1" },
      { minQty: 1000, unitPrice: "7.95" },
    ],
    sourceUpdatedAt: T0,
    sourceUrl: "https://www.mouser.cn/ProductDetail/595-MAX3232EIDR",
    supplierPriority: 25,
  },
  {
    provider: "MOUSER",
    providerPartNumber: "603-RC0603FR-0710KL",
    manufacturer: "YAGEO",
    mpn: "RC0603FR-0710KL",
    description: "Thick Film Resistors - SMD 10K OHM 1% 0603",
    packaging: "Tape & Reel",
    stock: 500000,
    moq: 5000,
    spq: 5000,
    leadTimeDays: 14,
    lifecycle: "NRND",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [
      { minQty: 5000, unitPrice: "0.0128" },
      { minQty: 25000, unitPrice: "0.0098" },
    ],
    sourceUpdatedAt: T0,
    sourceUrl: "https://www.mouser.cn/ProductDetail/603-RC0603FR-0710KL",
    supplierPriority: 25,
  },
];

export class MockMouserProvider implements DistributorProvider {
  readonly name = "MOUSER" as const;

  async getOffersByMpn(input: GetOffersInput): Promise<NormalizedOffer[]> {
    return OFFERS.filter(
      (o) =>
        mpnEquals(o.mpn, input.mpn) && manufacturerMatches(o.manufacturer, input.manufacturer),
    );
  }

  async searchCandidates(input: SearchCandidatesInput): Promise<OfferCandidate[]> {
    const kw = normalizeMpn(input.keyword) || input.keyword.toUpperCase();
    return OFFERS.filter((o) =>
      `${normalizeMpn(o.mpn)} ${(o.description ?? "").toUpperCase()}`.includes(kw),
    )
      .slice(0, Math.min(input.limit ?? 20, MOUSER_MAX_RECORDS))
      .map((o) => ({
        provider: "MOUSER" as const,
        providerPartNumber: o.providerPartNumber,
        mpn: o.mpn,
        manufacturer: o.manufacturer,
        description: o.description,
        sourceUrl: o.sourceUrl,
      }));
  }

  async getSubstitutes(): Promise<OfferCandidate[]> {
    return [];
  }

  async getRecommended(): Promise<OfferCandidate[]> {
    return [];
  }
}

export const MOCK_MOUSER_OFFERS = OFFERS;
