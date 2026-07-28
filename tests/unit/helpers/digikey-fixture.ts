/**
 * DigiKey V4 原始响应夹具(刻意使用 DigiKey 的原始字段形态:
 * 数字型价格、"8 Weeks" 交期、"ROHS3 Compliant" 合规文本),
 * 以便真正跑通归一化解析,而非把已归一化的数据喂回自己。
 */
import { startJsonServer, type FixtureRequest, type FixtureResponse } from "./http-fixture";

export const DK_TOKEN = "dk-access-token-DO-NOT-LOG";

const STM32 = {
  ManufacturerProductNumber: "STM32F103C8T6",
  Manufacturer: { Name: "STMicroelectronics" },
  Description: { ProductDescription: "MCU ARM Cortex-M3 64KB Flash LQFP-48" },
  QuantityAvailable: 5200,
  ProductUrl: "https://www.digikey.cn/product-detail/497-6063-ND",
  ProductStatus: { Status: "Active" },
  ManufacturerLeadWeeks: "8 Weeks",
  Classifications: { RohsStatus: "ROHS3 Compliant", ReachStatus: "REACH Unaffected" },
  ProductVariations: [
    {
      DigiKeyProductNumber: "497-6063-ND",
      PackageType: { Name: "Tray" },
      MinimumOrderQuantity: 1,
      StandardPackage: 1,
      QuantityAvailableforPackageType: 5200,
      StandardPricing: [
        { BreakQuantity: 1, UnitPrice: 28.6 },
        { BreakQuantity: 10, UnitPrice: 25.4 },
        { BreakQuantity: 100, UnitPrice: 22.15 },
        { BreakQuantity: 1000, UnitPrice: 19.8 },
      ],
    },
  ],
};

/** 同一 MPN 两种包装:MOQ/阶梯价不同,去重不得合并 */
const GRM188 = {
  ManufacturerProductNumber: "GRM188R71H104KA93D",
  Manufacturer: { Name: "Murata" },
  Description: { ProductDescription: "CAP CER 0.1uF 50V X7R 0603" },
  QuantityAvailable: 240000,
  ProductUrl: "https://www.digikey.cn/product-detail/490-1532-1-ND",
  ProductStatus: { Status: "Active" },
  ManufacturerLeadWeeks: "3 Weeks",
  Classifications: { RohsStatus: "ROHS3 Compliant", ReachStatus: "REACH Unaffected" },
  ProductVariations: [
    {
      DigiKeyProductNumber: "490-1532-1-ND",
      PackageType: { Name: "Cut Tape (CT)" },
      MinimumOrderQuantity: 1,
      StandardPackage: 1,
      QuantityAvailableforPackageType: 240000,
      StandardPricing: [
        { BreakQuantity: 1, UnitPrice: 0.72 },
        { BreakQuantity: 100, UnitPrice: 0.31 },
        { BreakQuantity: 1000, UnitPrice: 0.128 },
      ],
    },
    {
      DigiKeyProductNumber: "490-1532-2-ND",
      PackageType: { Name: "Tape & Reel (TR)" },
      MinimumOrderQuantity: 4000,
      StandardPackage: 4000,
      QuantityAvailableforPackageType: 200000,
      StandardPricing: [{ BreakQuantity: 4000, UnitPrice: 0.1085 }],
    },
  ],
};

const MAX232 = {
  ManufacturerProductNumber: "MAX232CPE",
  Manufacturer: { Name: "Analog Devices" },
  Description: { ProductDescription: "RS-232 收发器 DIP-16" },
  QuantityAvailable: 12,
  ProductUrl: "https://www.digikey.cn/product-detail/MAX232CPE",
  ProductStatus: { Status: "Obsolete" },
  Classifications: { RohsStatus: "Not Compliant", ReachStatus: "Unknown" },
  ProductVariations: [
    {
      DigiKeyProductNumber: "MAX232CPE+-ND",
      PackageType: { Name: "Tube" },
      MinimumOrderQuantity: 1,
      StandardPackage: 1,
      QuantityAvailableforPackageType: 12,
      StandardPricing: [{ BreakQuantity: 1, UnitPrice: 62.5 }],
    },
  ],
};

const MAX3232 = {
  ManufacturerProductNumber: "MAX3232EIDR",
  Manufacturer: { Name: "Texas Instruments" },
  Description: { ProductDescription: "RS-232 收发器 3-5.5V SOIC-16" },
  QuantityAvailable: 18000,
  ProductUrl: "https://www.digikey.cn/product-detail/296-19095-1-ND",
  ProductStatus: { Status: "Active" },
  ManufacturerLeadWeeks: "5 Weeks",
  Classifications: { RohsStatus: "ROHS3 Compliant", ReachStatus: "REACH Unaffected" },
  ProductVariations: [
    {
      DigiKeyProductNumber: "296-19095-1-ND",
      PackageType: { Name: "Cut Tape (CT)" },
      MinimumOrderQuantity: 1,
      StandardPackage: 1,
      QuantityAvailableforPackageType: 18000,
      StandardPricing: [
        { BreakQuantity: 1, UnitPrice: 13.2 },
        { BreakQuantity: 100, UnitPrice: 9.85 },
      ],
    },
  ],
};

/** 详情无阶梯价,需要回退 /pricing 取正式价格 */
const NOPRICE_DETAILS = {
  ManufacturerProductNumber: "NOPRICE-PART",
  Manufacturer: { Name: "TestMfg" },
  Description: { ProductDescription: "详情缺价,走 ProductPricing 兜底" },
  QuantityAvailable: 500,
  ProductStatus: { Status: "Active" },
  ProductVariations: [
    {
      DigiKeyProductNumber: "NOPRICE-1-ND",
      PackageType: { Name: "Bulk" },
      MinimumOrderQuantity: 1,
      StandardPackage: 1,
      QuantityAvailableforPackageType: 500,
    },
  ],
};

const NOPRICE_PRICING = {
  Product: {
    ManufacturerProductNumber: "NOPRICE-PART",
    ProductVariations: [
      {
        DigiKeyProductNumber: "NOPRICE-1-ND",
        PackageType: { Name: "Bulk" },
        MinimumOrderQuantity: 1,
        StandardPackage: 1,
        QuantityAvailableforPackageType: 500,
        StandardPricing: [{ BreakQuantity: 1, UnitPrice: 3.5 }],
      },
    ],
  },
};

const BY_MPN: Record<string, unknown> = {
  STM32F103C8T6: STM32,
  GRM188R71H104KA93D: GRM188,
  MAX232CPE: MAX232,
  MAX3232EIDR: MAX3232,
  "NOPRICE-PART": NOPRICE_DETAILS,
};

export function digiKeyRoutes(req: FixtureRequest): FixtureResponse | undefined {
  if (req.pathname === "/v1/oauth2/token") {
    return { json: { access_token: DK_TOKEN, expires_in: 600, token_type: "Bearer" } };
  }

  const details = req.pathname.match(/^\/products\/v4\/search\/([^/]+)\/productdetails$/);
  if (details) {
    const mpn = decodeURIComponent(details[1]);
    return { json: { Product: BY_MPN[mpn] ?? null } };
  }

  const pricing = req.pathname.match(/^\/products\/v4\/search\/([^/]+)\/pricing$/);
  if (pricing) {
    const mpn = decodeURIComponent(pricing[1]);
    if (mpn === "NOPRICE-PART") return { json: NOPRICE_PRICING };
    return { json: { Product: null } };
  }

  const subs = req.pathname.match(/^\/products\/v4\/search\/([^/]+)\/substitutions$/);
  if (subs) {
    const mpn = decodeURIComponent(subs[1]);
    return { json: { ProductSubstitutes: mpn === "MAX232CPE" ? [MAX3232] : [], Count: 1 } };
  }

  const rec = req.pathname.match(/^\/products\/v4\/search\/([^/]+)\/recommendedproducts$/);
  if (rec) return { json: { RecommendedProducts: [MAX3232] } };

  if (req.pathname === "/products/v4/search/keyword") {
    const body = req.body as { Keywords?: string } | null;
    const kw = (body?.Keywords ?? "").toUpperCase();
    const all = [STM32, GRM188, MAX232, MAX3232];
    const hit = all.filter((p) =>
      `${p.ManufacturerProductNumber} ${p.Description.ProductDescription} ${p.Manufacturer.Name}`
        .toUpperCase()
        .includes(kw),
    );
    // 刻意重复返回同一 MPN,验证候选去重
    return { json: { ExactMatches: hit.slice(0, 1), Products: hit, ProductsCount: hit.length } };
  }

  return undefined;
}

export function startDigiKeyFixture() {
  return startJsonServer(digiKeyRoutes);
}
