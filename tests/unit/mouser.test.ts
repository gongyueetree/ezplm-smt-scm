import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDistributorContract } from "./helpers/distributor-contract";
import { MOUSER_KEY, mouserRoutes, startMouserFixture } from "./helpers/mouser-fixture";
import { startJsonServer, type JsonFixtureServer } from "./helpers/http-fixture";
import {
  MockMouserProvider,
  MouserProvider,
  MouserRateLimiter,
  MOUSER_MAX_RECORDS,
} from "@/lib/providers/mouser";
import type { ApiUsageRecord } from "@/lib/providers/common/api-usage";

let server: JsonFixtureServer;

beforeAll(async () => {
  server = await startMouserFixture();
});
afterAll(async () => {
  await server.close();
});

const noWait = () => Promise.resolve();

function makeProvider(extra: Partial<ConstructorParameters<typeof MouserProvider>[0]> = {}) {
  return new MouserProvider({
    baseUrl: server.baseUrl,
    apiKey: MOUSER_KEY,
    currency: "CNY",
    retryBaseMs: 1,
    sleep: noWait,
    ...extra,
  });
}

// ===== 合同:Mock 与 Http 同一断言集 =====
runDistributorContract("MockMouserProvider", () => new MockMouserProvider(), {
  knownMpn: "STM32F103C8T6",
  knownManufacturer: "STMicroelectronics",
  keyword: "STM32",
});

runDistributorContract("MouserProvider(本地夹具)", () => makeProvider(), {
  knownMpn: "STM32F103C8T6",
  knownManufacturer: "STMicroelectronics",
  keyword: "STM32",
});

describe("Mouser 归一化(原始字段 → NormalizedOffer)", () => {
  it("'3100 In Stock' / '42 Days' / '¥27.90' 等原始形态正确解析", async () => {
    const [offer] = await makeProvider().getOffersByMpn({ mpn: "STM32F103C8T6" });
    expect(offer.providerPartNumber).toBe("511-STM32F103C8T6");
    expect(offer.stock).toBe(3100);
    expect(offer.leadTimeDays).toBe(42);
    expect(offer.moq).toBe(1);
    expect(offer.spq).toBe(1);
    expect(offer.lifecycle).toBe("ACTIVE");
    expect(offer.rohs).toBe(true);
    expect(offer.reach).toBe(true);
    expect(offer.packaging).toBe("Tray");
    expect(offer.currency).toBe("CNY");
    expect(offer.priceBreaks[0]).toEqual({ minQty: 1, unitPrice: "27.9" });
    expect(offer.priceBreaks.at(-1)).toEqual({ minQty: 1000, unitPrice: "20.4" });
  });

  it("千分位库存与 NRND 状态解析", async () => {
    const [offer] = await makeProvider().getOffersByMpn({ mpn: "RC0603FR-0710KL" });
    expect(offer.stock).toBe(500000);
    expect(offer.lifecycle).toBe("NRND");
    expect(offer.moq).toBe(5000);
    expect(offer.spq).toBe(5000);
    expect(offer.leadTimeDays).toBe(14); // "2 Weeks"
  });

  it("partnumber 检索的近似项被严格过滤(只留 MPN 完全一致者)", async () => {
    const offers = await makeProvider().getOffersByMpn({ mpn: "STM32F103C8T6" });
    expect(offers).toHaveLength(1);
    expect(offers[0].mpn).toBe("STM32F103C8T6");
  });

  it("带制造商时走 partnumberandmanufacturer 端点", async () => {
    const p = makeProvider();
    const before = server.requests.length;
    await p.getOffersByMpn({ mpn: "STM32F103C8T6", manufacturer: "STMicroelectronics" });
    const ops = server.requests.slice(before).map((r) => r.pathname);
    expect(ops).toContain("/api/v1/search/partnumberandmanufacturer");
  });

  it("关键字检索走 keyword 端点,且候选不含价格/库存", async () => {
    const p = makeProvider();
    const before = server.requests.length;
    const candidates = await p.searchCandidates({ keyword: "STM32" });
    expect(server.requests.slice(before).map((r) => r.pathname)).toContain("/api/v1/search/keyword");
    for (const c of candidates) {
      expect("priceBreaks" in c).toBe(false);
      expect("stock" in c).toBe(false);
    }
  });

  it("单次请求最多 50 条(SPEC §9)", async () => {
    const p = makeProvider();
    const before = server.requests.length;
    await p.searchCandidates({ keyword: "STM32", limit: 999 });
    const req = server.requests.slice(before).find((r) => r.pathname.endsWith("/keyword"))!;
    const body = req.body as { SearchByKeywordRequest: { records: number } };
    expect(body.SearchByKeywordRequest.records).toBe(MOUSER_MAX_RECORDS);
  });

  it("Mouser 以 HTTP 200 + Errors 报错时转结构化错误,不当作空结果", async () => {
    const errServer = await startJsonServer(() => ({
      json: { Errors: [{ Code: "InvalidApiKey", Message: "Invalid API key" }], SearchResults: null },
    }));
    try {
      await expect(
        makeProvider({ baseUrl: errServer.baseUrl }).getOffersByMpn({ mpn: "X" }),
      ).rejects.toMatchObject({ name: "ProviderError", provider: "MOUSER", kind: "http" });
    } finally {
      await errServer.close();
    }
  });
});

describe("MouserRateLimiter(SPEC §9:每分钟限流 + 每日配额)", () => {
  it("分钟窗口用满后拒绝,窗口滚动后恢复", () => {
    let now = 0;
    const limiter = new MouserRateLimiter({ perMinute: 2, perDay: 100, now: () => now });
    expect(limiter.acquire().ok).toBe(true);
    expect(limiter.acquire().ok).toBe(true);
    const denied = limiter.acquire();
    expect(denied).toMatchObject({ ok: false, reason: "minute" });
    expect((denied as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);

    now += 60_000;
    expect(limiter.acquire().ok).toBe(true);
  });

  it("日配额用尽后拒绝,且与分钟窗口独立", () => {
    let now = 0;
    const limiter = new MouserRateLimiter({ perMinute: 100, perDay: 3, now: () => now });
    for (let i = 0; i < 3; i++) expect(limiter.acquire().ok).toBe(true);
    expect(limiter.acquire()).toMatchObject({ ok: false, reason: "quota" });

    now += 60_000; // 分钟窗口滚动也不恢复日配额
    expect(limiter.acquire()).toMatchObject({ ok: false, reason: "quota" });

    now += 86_400_000;
    expect(limiter.acquire().ok).toBe(true);
  });

  it("status 只暴露计数,不含任何凭据", () => {
    const limiter = new MouserRateLimiter({ perMinute: 30, perDay: 1000 });
    limiter.acquire();
    expect(limiter.status()).toEqual({
      minuteUsed: 1,
      minuteLimit: 30,
      dayUsed: 1,
      dayLimit: 1000,
    });
  });

  it("分钟限流 → rate_limited(可重试);日配额耗尽 → quota_exceeded(不可重试)", async () => {
    let now = 0;
    const p = makeProvider({
      rateLimiter: new MouserRateLimiter({ perMinute: 1, perDay: 2, now: () => now }),
    });
    await p.getOffersByMpn({ mpn: "STM32F103C8T6" }); // 用掉 1 分钟额度 / 1 日额度
    await expect(p.getOffersByMpn({ mpn: "STM32F103C8T6" })).rejects.toMatchObject({
      kind: "rate_limited",
      retriable: true,
    });

    now += 60_000; // 分钟窗口恢复,日配额还剩 1
    await p.getOffersByMpn({ mpn: "STM32F103C8T6" });
    now += 60_000;
    await expect(p.getOffersByMpn({ mpn: "STM32F103C8T6" })).rejects.toMatchObject({
      kind: "quota_exceeded",
      retriable: false,
    });
  });
});

describe("Mouser 降级与密钥安全", () => {
  it("429/5xx 退避重试后成功", async () => {
    let calls = 0;
    const flaky = makeProvider({
      retries: 2,
      fetchImpl: async (input, init) => {
        calls += 1;
        if (calls <= 2) return new Response("rate", { status: calls === 1 ? 429 : 503 });
        return fetch(input, init);
      },
    });
    const offers = await flaky.getOffersByMpn({ mpn: "STM32F103C8T6" });
    expect(offers).toHaveLength(1);
    expect(calls).toBe(3);
  });

  it("apiKey 不出现在用量记录端点中(query 参数已脱敏)", async () => {
    const records: ApiUsageRecord[] = [];
    const p = makeProvider({ usageRecorder: { record: (u) => records.push(u) } });
    await p.getOffersByMpn({ mpn: "STM32F103C8T6" });
    expect(records.length).toBeGreaterThan(0);
    const dump = JSON.stringify(records);
    expect(dump).not.toContain(MOUSER_KEY);
    expect(records[0].endpoint).toContain("apiKey=***");
    expect(records[0].provider).toBe("MOUSER");
  });

  it("错误消息不含 apiKey 明文", async () => {
    const bad = await startJsonServer(() => ({ status: 500, json: { error: "boom" } }));
    try {
      await makeProvider({ baseUrl: bad.baseUrl, retries: 0 })
        .getOffersByMpn({ mpn: "STM32F103C8T6" })
        .catch((e) => {
          expect(e.message).not.toContain(MOUSER_KEY);
          expect(e.message).toContain("apiKey=***");
        });
    } finally {
      await bad.close();
    }
  });

  it("响应结构不符合契约 → validation 错误", async () => {
    const bad = await startJsonServer(() => ({
      json: { SearchResults: { Parts: [{ ManufacturerPartNumber: 123 }] } },
    }));
    try {
      await expect(
        makeProvider({ baseUrl: bad.baseUrl, retries: 0 }).getOffersByMpn({ mpn: "X" }),
      ).rejects.toMatchObject({ kind: "validation" });
    } finally {
      await bad.close();
    }
  });

  it("夹具路由未命中时不静默返回空(404 转结构化错误)", async () => {
    const empty = await startJsonServer(() => undefined);
    try {
      await expect(
        makeProvider({ baseUrl: empty.baseUrl, retries: 0 }).getOffersByMpn({ mpn: "X" }),
      ).rejects.toMatchObject({ provider: "MOUSER", status: 404 });
    } finally {
      await empty.close();
    }
  });

  it("mouserRoutes 夹具本身可复用(供其它测试组合)", () => {
    const res = mouserRoutes({
      method: "POST",
      pathname: "/api/v1/search/partnumber",
      searchParams: new URLSearchParams(),
      headers: {},
      body: { SearchByPartRequest: { mouserPartNumber: "STM32F103C8T6" } },
    });
    expect(res).toBeTruthy();
  });
});
