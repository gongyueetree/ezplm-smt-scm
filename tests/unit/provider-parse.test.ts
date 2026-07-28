import { describe, expect, it } from "vitest";
import { ProviderError, redactUrl } from "@/lib/providers/common/errors";
import {
  parseCompliance,
  parseLeadTimeDays,
  parseLifecycle,
  parseMoneyString,
  parseQuantity,
  toDecimalString,
} from "@/lib/providers/common/parse";
import {
  CACHE_TTL_SECONDS,
  InMemoryOfferCache,
  buildOfferCacheKey,
  isExpired,
} from "@/lib/providers/common/cache";
import { dedupeOffers } from "@/lib/providers/common/dedupe";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";

describe("三方字段解析(解析不了就返回 null,不猜数值)", () => {
  it("toDecimalString:JSON 数字不落科学计数法", () => {
    expect(toDecimalString(0.0865)).toBe("0.0865");
    expect(toDecimalString(0.0000001)).toBe("0.0000001");
    expect(toDecimalString("1.5")).toBe("1.5");
    expect(toDecimalString(null)).toBeNull();
    expect(toDecimalString("abc")).toBeNull();
  });

  it("parseMoneyString:货币符号、千分位、逗号小数", () => {
    expect(parseMoneyString("¥1.23")).toBe("1.23");
    expect(parseMoneyString("$1,234.56")).toBe("1234.56");
    expect(parseMoneyString("1,23 €")).toBe("1.23");
    expect(parseMoneyString("1.234,56")).toBe("1234.56");
    expect(parseMoneyString("1,234")).toBe("1234");
    expect(parseMoneyString(0.31)).toBe("0.31");
    expect(parseMoneyString("N/A")).toBeNull();
    expect(parseMoneyString(null)).toBeNull();
  });

  it("parseQuantity:'500 In Stock' 与千分位", () => {
    expect(parseQuantity("500 In Stock")).toBe(500);
    expect(parseQuantity("1,200")).toBe(1200);
    expect(parseQuantity(3100)).toBe(3100);
    expect(parseQuantity("None")).toBeNull();
  });

  it("parseLeadTimeDays:周/天单位换算", () => {
    expect(parseLeadTimeDays("10 Weeks")).toBe(70);
    expect(parseLeadTimeDays("14 Days")).toBe(14);
    expect(parseLeadTimeDays("6周")).toBe(42);
    expect(parseLeadTimeDays(21)).toBe(21);
    expect(parseLeadTimeDays("暂无")).toBeNull();
  });

  it("parseLifecycle:未知一律 UNKNOWN,不猜 ACTIVE", () => {
    expect(parseLifecycle("Active")).toBe("ACTIVE");
    expect(parseLifecycle("Not For New Designs")).toBe("NRND");
    expect(parseLifecycle("Obsolete")).toBe("OBSOLETE");
    expect(parseLifecycle("Discontinued at Digi-Key")).toBe("EOL");
    expect(parseLifecycle("")).toBe("UNKNOWN");
    expect(parseLifecycle(null)).toBe("UNKNOWN");
  });

  it("parseCompliance:未知返回 null,不臆断合规", () => {
    expect(parseCompliance("ROHS3 Compliant")).toBe(true);
    expect(parseCompliance("Not Compliant")).toBe(false);
    expect(parseCompliance("REACH Unaffected")).toBe(true);
    expect(parseCompliance("REACH Affected")).toBe(false);
    expect(parseCompliance("Unknown")).toBeNull();
    expect(parseCompliance(null)).toBeNull();
  });
});

describe("密钥脱敏(安全纪律:Key 不得出现在日志/错误中)", () => {
  it("redactUrl 抹掉 apiKey/token 类查询参数", () => {
    expect(redactUrl("https://api.mouser.com/api/v1/search/partnumber?apiKey=SECRET123")).toBe(
      "https://api.mouser.com/api/v1/search/partnumber?apiKey=***",
    );
    expect(redactUrl("https://x.test/a?access_token=abc&q=1")).toContain("access_token=***");
    expect(redactUrl("https://x.test/a?access_token=abc&q=1")).toContain("q=1");
  });

  it("相对路径同样脱敏", () => {
    expect(redactUrl("/api/v1/search/keyword?apiKey=SECRET123")).toBe(
      "/api/v1/search/keyword?apiKey=***",
    );
  });

  it("无敏感参数时保持原样", () => {
    expect(redactUrl("https://api.digikey.com/products/v4/search/ABC/pricing")).toBe(
      "https://api.digikey.com/products/v4/search/ABC/pricing",
    );
  });

  it("ProviderError.toSafeJSON 不含 cause,避免嵌套泄漏", () => {
    const err = new ProviderError("MOUSER", "http", "Mouser HTTP 500: /api/v1/search/partnumber?apiKey=***", {
      status: 500,
      retriable: true,
      cause: { secret: "SHOULD-NOT-LEAK" },
    });
    const safe = JSON.stringify(err.toSafeJSON());
    expect(safe).not.toContain("SHOULD-NOT-LEAK");
    expect(safe).toContain("MOUSER");
    expect(safe).toContain("500");
  });
});

describe("外部 API 缓存(SPEC §15)", () => {
  it("缓存键 = provider+site+currency+mpn+manufacturer+quantity", () => {
    const key = buildOfferCacheKey({
      provider: "DIGIKEY",
      site: "CN",
      currency: "CNY",
      mpn: "STM32F103C8T6",
      manufacturer: "STMicroelectronics",
      quantity: 1000,
    });
    expect(key).toBe("DIGIKEY|CN|CNY|STM32F103C8T6|STMICROELECTRONICS|1000");
  });

  it("大小写与分隔符差异不产生重复缓存", () => {
    const a = buildOfferCacheKey({
      provider: "MOUSER",
      site: null,
      currency: "cny",
      mpn: "rc0603fr-07 10kl",
      quantity: null,
    });
    const b = buildOfferCacheKey({
      provider: "MOUSER",
      site: null,
      currency: "CNY",
      mpn: "RC0603FR0710KL",
      quantity: null,
    });
    expect(a).toBe(b);
  });

  it("不同数量产生不同缓存键(阶梯价随数量变化)", () => {
    const base = { provider: "DIGIKEY" as const, site: "CN", currency: "CNY", mpn: "X" };
    expect(buildOfferCacheKey({ ...base, quantity: 100 })).not.toBe(
      buildOfferCacheKey({ ...base, quantity: 1000 }),
    );
  });

  it("TTL:价格/库存 15 分钟,规格/合规 24 小时;到期即失效", async () => {
    expect(CACHE_TTL_SECONDS.PRICE_STOCK).toBe(15 * 60);
    expect(CACHE_TTL_SECONDS.SPEC_LIFECYCLE_COMPLIANCE).toBe(24 * 60 * 60);

    let now = new Date("2026-07-27T00:00:00.000Z");
    const cache = new InMemoryOfferCache(() => now);
    await cache.set("t1", "DIGIKEY", "k1", { price: "1.0" }, CACHE_TTL_SECONDS.PRICE_STOCK);
    expect(await cache.get("t1", "DIGIKEY", "k1")).not.toBeNull();

    now = new Date("2026-07-27T00:14:59.000Z");
    expect(await cache.get("t1", "DIGIKEY", "k1")).not.toBeNull();

    now = new Date("2026-07-27T00:15:00.000Z");
    expect(await cache.get("t1", "DIGIKEY", "k1")).toBeNull();
  });

  it("缓存按租户隔离(CLAUDE.md 多租户纪律)", async () => {
    const cache = new InMemoryOfferCache();
    await cache.set("t1", "MOUSER", "k", { v: 1 }, 600);
    expect(await cache.get("t2", "MOUSER", "k")).toBeNull();
    expect(await cache.get("t1", "MOUSER", "k")).not.toBeNull();
  });

  it("isExpired 边界:恰好到期视为过期", () => {
    const entry = { value: 1, fetchedAt: new Date("2026-07-27T00:00:00Z"), ttlSeconds: 60 };
    expect(isExpired(entry, new Date("2026-07-27T00:00:59Z"))).toBe(false);
    expect(isExpired(entry, new Date("2026-07-27T00:01:00Z"))).toBe(true);
  });
});

describe("相同 MPN 去重(SPEC §8)", () => {
  const base: NormalizedOffer = {
    provider: "DIGIKEY",
    providerPartNumber: "a",
    manufacturer: "Murata Electronics",
    mpn: "GRM188R71H104KA93D",
    description: null,
    packaging: null,
    stock: 100,
    moq: 1,
    spq: 1,
    leadTimeDays: 20,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [{ minQty: 1, unitPrice: "1" }],
    sourceUpdatedAt: null,
    sourceUrl: null,
  };

  it("同一采购选项被重复返回时合并,保留阶梯更全者", () => {
    const thin = { ...base, description: "thin" };
    const rich = {
      ...base,
      description: "rich",
      mpn: "grm188r71h104ka93d", // 大小写差异,标准化后同一 MPN
      priceBreaks: [
        { minQty: 1, unitPrice: "1" },
        { minQty: 100, unitPrice: "0.5" },
      ],
    };
    const out = dedupeOffers([thin, rich]);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("rich");
  });

  it("阶梯数相同则保留库存更多者", () => {
    const low = { ...base, description: "low", stock: 10 };
    const high = { ...base, description: "high", stock: 9000 };
    expect(dedupeOffers([low, high])[0].description).toBe("high");
  });

  it("同 MPN 不同包装(CT / T&R)不得合并 —— MOQ 与阶梯价不同,是两个采购选项", () => {
    const cutTape = { ...base, providerPartNumber: "490-1532-1-ND", packaging: "Cut Tape (CT)" };
    const reel = {
      ...base,
      providerPartNumber: "490-1532-2-ND",
      packaging: "Tape & Reel (TR)",
      moq: 4000,
      spq: 4000,
    };
    const out = dedupeOffers([cutTape, reel]);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.packaging)).toEqual(["Cut Tape (CT)", "Tape & Reel (TR)"]);
  });

  it("不同 provider 的同 MPN 报价不合并(比价需要两条)", () => {
    const dk = { ...base };
    const mo = { ...base, provider: "MOUSER" as const };
    expect(dedupeOffers([dk, mo])).toHaveLength(2);
  });

  it("输出顺序稳定(按首次出现顺序)", () => {
    const a = { ...base, mpn: "AAA" };
    const b = { ...base, mpn: "BBB" };
    expect(dedupeOffers([b, a]).map((o) => o.mpn)).toEqual(["BBB", "AAA"]);
  });
});
