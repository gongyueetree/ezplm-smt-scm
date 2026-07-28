/**
 * Mouser Search API v1 原始响应夹具(保留其原始形态:
 * "3100 In Stock"、"42 Days"、"¥27.90" 价格串、字符串型 Min/Mult)。
 */
import { startJsonServer, type FixtureRequest, type FixtureResponse } from "./http-fixture";

export const MOUSER_KEY = "mouser-api-key-DO-NOT-LOG";

const STM32 = {
  MouserPartNumber: "511-STM32F103C8T6",
  ManufacturerPartNumber: "STM32F103C8T6",
  Manufacturer: "STMicroelectronics",
  Description: "ARM Microcontrollers - MCU 32BIT Cortex M3 64KB",
  Availability: "3100 In Stock",
  LeadTime: "42 Days",
  Min: "1",
  Mult: "1",
  LifecycleStatus: "Active",
  ROHSStatus: "RoHS Compliant",
  ReachStatus: "REACH Unaffected",
  ProductDetailUrl: "https://www.mouser.cn/ProductDetail/511-STM32F103C8T6",
  PackagingOptions: ["Tray"],
  PriceBreaks: [
    { Quantity: 1, Price: "¥27.90", Currency: "CNY" },
    { Quantity: 10, Price: "¥24.80", Currency: "CNY" },
    { Quantity: 100, Price: "¥21.60", Currency: "CNY" },
    { Quantity: 1000, Price: "¥20.40", Currency: "CNY" },
  ],
};

/** 近似项:partnumber 检索可能带回的其它 MPN,必须被严格过滤掉 */
const STM32_NEAR = {
  ...STM32,
  MouserPartNumber: "511-STM32F103CBT6",
  ManufacturerPartNumber: "STM32F103CBT6",
  Description: "ARM Microcontrollers - MCU 32BIT Cortex M3 128KB",
};

const RC0603 = {
  MouserPartNumber: "603-RC0603FR-0710KL",
  ManufacturerPartNumber: "RC0603FR-0710KL",
  Manufacturer: "YAGEO",
  Description: "Thick Film Resistors - SMD 10K OHM 1% 0603",
  Availability: "500,000 In Stock",
  LeadTime: "2 Weeks",
  Min: "5000",
  Mult: "5000",
  LifecycleStatus: "Not For New Designs",
  ROHSStatus: "RoHS Compliant",
  ProductDetailUrl: "https://www.mouser.cn/ProductDetail/603-RC0603FR-0710KL",
  PackagingOptions: ["Tape & Reel"],
  PriceBreaks: [
    { Quantity: 5000, Price: "¥0.0128", Currency: "CNY" },
    { Quantity: 25000, Price: "¥0.0098", Currency: "CNY" },
  ],
};

const ALL = [STM32, STM32_NEAR, RC0603];

export function mouserRoutes(req: FixtureRequest): FixtureResponse | undefined {
  if (!req.pathname.startsWith("/api/v1/search/")) return undefined;
  const op = req.pathname.replace("/api/v1/search/", "");
  const body = req.body as Record<string, Record<string, unknown>> | null;

  if (op === "partnumber" || op === "partnumberandmanufacturer") {
    const request = body?.SearchByPartRequest ?? body?.SearchByPartMfrNameRequest ?? {};
    const pn = String(request.mouserPartNumber ?? "").toUpperCase();
    const mfr = String(request.manufacturerName ?? "").toUpperCase();
    const parts = ALL.filter(
      (p) =>
        p.ManufacturerPartNumber.toUpperCase().startsWith(pn.slice(0, 8)) &&
        (!mfr || p.Manufacturer.toUpperCase().includes(mfr)),
    );
    return { json: { Errors: [], SearchResults: { NumberOfResult: parts.length, Parts: parts } } };
  }

  if (op === "keyword" || op === "keywordandmanufacturer") {
    const request = body?.SearchByKeywordRequest ?? body?.SearchByKeywordMfrNameRequest ?? {};
    const kw = String(request.keyword ?? "").toUpperCase();
    const records = Number(request.records ?? 20);
    const parts = ALL.filter((p) =>
      `${p.ManufacturerPartNumber} ${p.Description} ${p.Manufacturer}`.toUpperCase().includes(kw),
    );
    return {
      json: {
        Errors: [],
        SearchResults: { NumberOfResult: parts.length, Parts: parts.slice(0, records) },
      },
    };
  }

  return undefined;
}

export function startMouserFixture() {
  return startJsonServer(mouserRoutes);
}
