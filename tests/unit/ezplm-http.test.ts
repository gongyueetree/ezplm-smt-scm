import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runEzplmProviderContract } from "./helpers/ezplm-contract";
import { startFixtureServer, type FixtureServer } from "./helpers/ezplm-fixture-server";
import { HttpEzplmProvider } from "@/lib/providers/ezplm";

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

const noWait = () => Promise.resolve();

function makeProvider(extra: Partial<ConstructorParameters<typeof HttpEzplmProvider>[0]> = {}) {
  return new HttpEzplmProvider({
    baseUrl: server.baseUrl,
    apiKey: "test-key",
    retryBaseMs: 1,
    sleep: noWait,
    ...extra,
  });
}

// ===== 合同测试:与 Mock 同一断言集(双实现同构)=====
runEzplmProviderContract("HttpEzplmProvider(本地夹具服务)", () => makeProvider());

// ===== 行为测试:鉴权头 / 校验 / 重试 / 超时 / 熔断 =====
describe("HttpEzplmProvider 行为", () => {
  it("请求携带 Bearer API Key(仅服务端环境变量,不经浏览器)", async () => {
    const p = makeProvider();
    await p.getPartByMpn({ mpn: "STM32F103C8T6" });
    const last = server.requests[server.requests.length - 1];
    expect(last.auth).toBe("Bearer test-key");
  });

  it("响应不符合 Zod 契约 → validation 结构化错误", async () => {
    const bad = makeProvider({
      fetchImpl: async () =>
        new Response(JSON.stringify([{ totally: "wrong" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    await expect(bad.searchParts({ keyword: "x" })).rejects.toMatchObject({
      name: "ProviderError",
      provider: "EZPLM",
      kind: "validation",
    });
  });

  it("5xx 退避重试后成功(SPEC §7 retry)", async () => {
    let calls = 0;
    const flaky = makeProvider({
      retries: 2,
      fetchImpl: async (input, init) => {
        calls += 1;
        if (calls <= 2) return new Response("boom", { status: 500 });
        return fetch(input, init);
      },
    });
    const part = await flaky.getPartByMpn({ mpn: "STM32F103C8T6" });
    expect(part?.internalPn).toBe("QC-IC-0001");
    expect(calls).toBe(3);
  });

  it("重试耗尽 → http 结构化错误(不阻断整个 BOM,由上层按行降级)", async () => {
    const dead = makeProvider({
      retries: 1,
      fetchImpl: async () => new Response("boom", { status: 503 }),
    });
    await expect(dead.searchParts({ keyword: "x" })).rejects.toMatchObject({
      kind: "http",
      status: 503,
    });
  });

  it("429 触发重试", async () => {
    let calls = 0;
    const limited = makeProvider({
      retries: 1,
      fetchImpl: async (input, init) => {
        calls += 1;
        if (calls === 1) return new Response("rate", { status: 429 });
        return fetch(input, init);
      },
    });
    await limited.getPartByMpn({ mpn: "STM32F103C8T6" });
    expect(calls).toBe(2);
  });

  it("超时 → timeout 结构化错误(AbortController)", async () => {
    const slow = makeProvider({
      timeoutMs: 30,
      retries: 0,
      fetchImpl: (input, init) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(new Response("{}", { status: 200 })), 500);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    });
    await expect(slow.getCompliance("ezp-1001")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("连续失败达到阈值后熔断:后续请求短路,不再打到服务端;冷却后半开恢复", async () => {
    let now = 0;
    let calls = 0;
    const failing = makeProvider({
      retries: 0,
      breaker: { failureThreshold: 2, cooldownMs: 1000, now: () => now },
      fetchImpl: async (input, init) => {
        calls += 1;
        if (calls <= 2) return new Response("boom", { status: 500 });
        return fetch(input, init);
      },
    });
    await expect(failing.searchParts({ keyword: "x" })).rejects.toMatchObject({ kind: "http" });
    await expect(failing.searchParts({ keyword: "x" })).rejects.toMatchObject({ kind: "http" });
    // 已达阈值 → 熔断打开,短路且不增加服务端调用
    const callsBefore = calls;
    await expect(failing.searchParts({ keyword: "x" })).rejects.toMatchObject({
      kind: "circuit_open",
    });
    expect(calls).toBe(callsBefore);
    // 冷却后半开放行,一次成功即恢复
    now = 2000;
    const rows = await failing.searchParts({ keyword: "STM32" });
    expect(rows.length).toBeGreaterThan(0);
  });
});
