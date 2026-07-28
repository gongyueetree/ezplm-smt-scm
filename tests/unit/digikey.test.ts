import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDistributorContract } from "./helpers/distributor-contract";
import { DK_TOKEN, digiKeyRoutes, startDigiKeyFixture } from "./helpers/digikey-fixture";
import { startJsonServer, type JsonFixtureServer } from "./helpers/http-fixture";
import { DigiKeyProvider, DigiKeyTokenStore, MockDigiKeyProvider } from "@/lib/providers/digikey";
import type { ApiUsageRecord } from "@/lib/providers/common/api-usage";

let server: JsonFixtureServer;

beforeAll(async () => {
  server = await startDigiKeyFixture();
});
afterAll(async () => {
  await server.close();
});

const noWait = () => Promise.resolve();

function makeProvider(extra: Partial<ConstructorParameters<typeof DigiKeyProvider>[0]> = {}) {
  return new DigiKeyProvider({
    baseUrl: server.baseUrl,
    clientId: "test-client-id",
    clientSecret: "test-client-secret-DO-NOT-LOG",
    accountId: "acct-1",
    site: "CN",
    language: "zh",
    currency: "CNY",
    retryBaseMs: 1,
    sleep: noWait,
    ...extra,
  });
}

// ===== 合同:Mock 与 Http 同一断言集 =====
runDistributorContract("MockDigiKeyProvider", () => new MockDigiKeyProvider(), {
  knownMpn: "STM32F103C8T6",
  knownManufacturer: "STMicroelectronics",
  keyword: "STM32",
});

runDistributorContract("DigiKeyProvider(本地夹具)", () => makeProvider(), {
  knownMpn: "STM32F103C8T6",
  knownManufacturer: "STMicroelectronics",
  keyword: "STM32",
});

// ===== 归一化 =====
describe("DigiKey 归一化(V4 原始字段 → NormalizedOffer)", () => {
  it("价格/库存/MOQ/SPQ/交期/生命周期/合规逐项正确落位", async () => {
    const [offer] = await makeProvider().getOffersByMpn({ mpn: "STM32F103C8T6" });
    expect(offer.providerPartNumber).toBe("497-6063-ND");
    expect(offer.manufacturer).toBe("STMicroelectronics");
    expect(offer.packaging).toBe("Tray");
    expect(offer.stock).toBe(5200);
    expect(offer.moq).toBe(1);
    expect(offer.spq).toBe(1);
    expect(offer.leadTimeDays).toBe(56); // "8 Weeks"
    expect(offer.lifecycle).toBe("ACTIVE");
    expect(offer.rohs).toBe(true);
    expect(offer.reach).toBe(true); // "REACH Unaffected"
    expect(offer.currency).toBe("CNY");
    expect(offer.priceBreaks).toEqual([
      { minQty: 1, unitPrice: "28.6" },
      { minQty: 10, unitPrice: "25.4" },
      { minQty: 100, unitPrice: "22.15" },
      { minQty: 1000, unitPrice: "19.8" },
    ]);
  });

  it("停产料:lifecycle=OBSOLETE、RoHS=false、REACH 未知为 null(不臆断)", async () => {
    const [offer] = await makeProvider().getOffersByMpn({ mpn: "MAX232CPE" });
    expect(offer.lifecycle).toBe("OBSOLETE");
    expect(offer.rohs).toBe(false);
    expect(offer.reach).toBeNull();
    expect(offer.leadTimeDays).toBeNull();
  });

  it("同一 MPN 的两种包装各成一条报价(不被去重合并)", async () => {
    const offers = await makeProvider().getOffersByMpn({ mpn: "GRM188R71H104KA93D" });
    expect(offers).toHaveLength(2);
    expect(offers.map((o) => o.packaging)).toEqual(["Cut Tape (CT)", "Tape & Reel (TR)"]);
    expect(offers[1].moq).toBe(4000);
    expect(offers[1].spq).toBe(4000);
  });

  it("sourceUpdatedAt 为抓取时间(诚实 UI 用,不暗示实时)", async () => {
    const fixed = new Date("2026-07-27T10:00:00.000Z");
    const [offer] = await makeProvider({ nowDate: () => fixed }).getOffersByMpn({
      mpn: "STM32F103C8T6",
    });
    expect(offer.sourceUpdatedAt).toBe("2026-07-27T10:00:00.000Z");
  });

  it("详情无阶梯价时回退 ProductPricing 正式取价(不使用 KeywordSearch 价格)", async () => {
    const p = makeProvider();
    const before = server.requests.length;
    const [offer] = await p.getOffersByMpn({ mpn: "NOPRICE-PART" });
    const paths = server.requests.slice(before).map((r) => r.pathname);
    expect(paths).toContain("/products/v4/search/NOPRICE-PART/productdetails");
    expect(paths).toContain("/products/v4/search/NOPRICE-PART/pricing");
    expect(paths.some((x) => x.includes("keyword"))).toBe(false);
    expect(offer.priceBreaks).toEqual([{ minQty: 1, unitPrice: "3.5" }]);
  });

  it("KeywordSearch 重复 MPN 去重(SPEC §8)", async () => {
    const candidates = await makeProvider().searchCandidates({ keyword: "STM32" });
    const mpns = candidates.map((c) => c.mpn);
    expect(new Set(mpns).size).toBe(mpns.length);
  });

  it("Substitutions / RecommendedProducts 走各自端点", async () => {
    const p = makeProvider();
    const subs = await p.getSubstitutes("MAX232CPE");
    expect(subs.map((s) => s.mpn)).toEqual(["MAX3232EIDR"]);
    const rec = await p.getRecommended("STM32F103C8T6");
    expect(rec.length).toBeGreaterThan(0);
  });
});

// ===== OAuth / Header / 观测 =====
describe("DigiKey OAuth 与请求头(SPEC §8)", () => {
  it("token 服务端缓存:多次业务调用只取一次 token", async () => {
    const p = makeProvider();
    const before = server.requests.filter((r) => r.pathname === "/v1/oauth2/token").length;
    await p.getOffersByMpn({ mpn: "STM32F103C8T6" });
    await p.getOffersByMpn({ mpn: "MAX3232EIDR" });
    const after = server.requests.filter((r) => r.pathname === "/v1/oauth2/token").length;
    expect(after - before).toBe(1);
  });

  it("并发请求共享同一次 token 刷新(单飞)", async () => {
    const p = makeProvider();
    const before = server.requests.filter((r) => r.pathname === "/v1/oauth2/token").length;
    await Promise.all([
      p.getOffersByMpn({ mpn: "STM32F103C8T6" }),
      p.getOffersByMpn({ mpn: "MAX3232EIDR" }),
      p.getOffersByMpn({ mpn: "GRM188R71H104KA93D" }),
    ]);
    const after = server.requests.filter((r) => r.pathname === "/v1/oauth2/token").length;
    expect(after - before).toBe(1);
  });

  it("Account ID 与 Locale Header 可配置并随请求发送", async () => {
    const p = makeProvider({ site: "US", language: "en", currency: "USD", accountId: "acct-9" });
    const before = server.requests.length;
    await p.getOffersByMpn({ mpn: "STM32F103C8T6" });
    const req = server.requests.slice(before).find((r) => r.pathname.includes("productdetails"))!;
    expect(req.headers["x-digikey-locale-site"]).toBe("US");
    expect(req.headers["x-digikey-locale-language"]).toBe("en");
    expect(req.headers["x-digikey-locale-currency"]).toBe("USD");
    expect(req.headers["x-digikey-customer-id"]).toBe("acct-9");
    expect(req.headers["authorization"]).toBe(`Bearer ${DK_TOKEN}`);
  });

  it("401 时清除缓存 token 并自动刷新重试(SPEC §8:自动刷新)", async () => {
    let tokenCalls = 0;
    let detailCalls = 0;
    const flaky = await startJsonServer((req) => {
      if (req.pathname === "/v1/oauth2/token") {
        tokenCalls += 1;
        return { json: { access_token: `tok-${tokenCalls}`, expires_in: 600 } };
      }
      if (req.pathname.includes("productdetails")) {
        detailCalls += 1;
        // 首次用旧 token 返回 401,刷新后放行
        if (detailCalls === 1) return { status: 401, json: { error: "expired" } };
        return digiKeyRoutes(req);
      }
      return digiKeyRoutes(req);
    });
    try {
      const p = makeProvider({ baseUrl: flaky.baseUrl });
      const offers = await p.getOffersByMpn({ mpn: "STM32F103C8T6" });
      expect(offers.length).toBeGreaterThan(0);
      expect(tokenCalls).toBe(2); // 初次 + 401 后刷新
      expect(detailCalls).toBe(2);
    } finally {
      await flaky.close();
    }
  });

  it("TokenStore 提前过期并只暴露非敏感状态", () => {
    let now = 1_000_000;
    const store = new DigiKeyTokenStore(() => now);
    expect(store.get()).toBeNull();
    store.set("secret-token", 600); // 安全窗口 60s → 实际有效 540s
    expect(store.get()?.accessToken).toBe("secret-token");
    expect(JSON.stringify(store.status())).not.toContain("secret-token");

    now += 539_000;
    expect(store.get()).not.toBeNull();
    now += 2_000;
    expect(store.get()).toBeNull(); // 提前于服务端 600s 过期
  });

  it("记录 X-RateLimit 与已脱敏端点(SPEC §8)", async () => {
    const records: ApiUsageRecord[] = [];
    const limited = await startJsonServer((req) => {
      const base = digiKeyRoutes(req);
      return base
        ? { ...base, headers: { "X-RateLimit-Limit": "1000", "X-RateLimit-Remaining": "997" } }
        : base;
    });
    try {
      const p = makeProvider({
        baseUrl: limited.baseUrl,
        usageRecorder: { record: (u) => records.push(u) },
      });
      await p.getOffersByMpn({ mpn: "STM32F103C8T6" });
      const detail = records.find((r) => r.endpoint.includes("productdetails"))!;
      expect(detail.provider).toBe("DIGIKEY");
      expect(detail.statusCode).toBe(200);
      expect(detail.rateLimitLimit).toBe(1000);
      expect(detail.rateLimitRemaining).toBe(997);
      expect(typeof detail.durationMs).toBe("number");
    } finally {
      await limited.close();
    }
  });
});

// ===== 降级与安全 =====
describe("DigiKey 降级与密钥安全", () => {
  it("provider 不可用时抛结构化错误(调用方按行降级,不阻断整单)", async () => {
    const dead = makeProvider({
      retries: 1,
      fetchImpl: async (input) =>
        String(input).includes("oauth2")
          ? new Response(JSON.stringify({ access_token: "t", expires_in: 600 }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          : new Response("boom", { status: 503 }),
    });
    await expect(dead.getOffersByMpn({ mpn: "STM32F103C8T6" })).rejects.toMatchObject({
      name: "ProviderError",
      provider: "DIGIKEY",
      kind: "http",
      status: 503,
    });
  });

  it("响应结构不符合契约 → validation 错误", async () => {
    const bad = await startJsonServer((req) =>
      req.pathname === "/v1/oauth2/token"
        ? { json: { access_token: "t", expires_in: 600 } }
        : { json: { Product: { ManufacturerProductNumber: 12345 } } },
    );
    try {
      await expect(
        makeProvider({ baseUrl: bad.baseUrl, retries: 0 }).getOffersByMpn({ mpn: "X" }),
      ).rejects.toMatchObject({ kind: "validation" });
    } finally {
      await bad.close();
    }
  });

  it("错误消息与用量记录都不含 client secret / token 明文", async () => {
    const records: ApiUsageRecord[] = [];
    const bad = await startJsonServer((req) =>
      req.pathname === "/v1/oauth2/token"
        ? { json: { access_token: DK_TOKEN, expires_in: 600 } }
        : { status: 500, json: { error: "boom" } },
    );
    try {
      const p = makeProvider({
        baseUrl: bad.baseUrl,
        retries: 0,
        usageRecorder: { record: (u) => records.push(u) },
      });
      await p.getOffersByMpn({ mpn: "STM32F103C8T6" }).catch((e) => {
        const text = `${e.message}${JSON.stringify(e.toSafeJSON())}`;
        expect(text).not.toContain("test-client-secret-DO-NOT-LOG");
        expect(text).not.toContain(DK_TOKEN);
      });
      const dump = JSON.stringify(records);
      expect(dump).not.toContain("test-client-secret-DO-NOT-LOG");
      expect(dump).not.toContain(DK_TOKEN);
    } finally {
      await bad.close();
    }
  });

  it("OAuth 失败不回显请求体(含 secret),只给状态码", async () => {
    const bad = await startJsonServer((req) =>
      req.pathname === "/v1/oauth2/token" ? { status: 401, json: { error: "invalid_client" } } : undefined,
    );
    try {
      await makeProvider({ baseUrl: bad.baseUrl, retries: 0 })
        .getOffersByMpn({ mpn: "X" })
        .catch((e) => {
          expect(e.kind).toBe("auth");
          expect(e.message).toContain("401");
          expect(e.message).not.toContain("test-client-secret-DO-NOT-LOG");
        });
    } finally {
      await bad.close();
    }
  });
});
