/**
 * R3-1:共享限流 + 可信代理 IP 解析。
 * P0-B 回归:①限流不再是纯进程内(provider 抽象,生产默认 postgres);
 * ②x-forwarded-for 伪造段取不到(右起可信跳数);③P2-5 活跃桶不被 FIFO 误逐。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryRateLimitProvider,
  clientIpFromHeaders,
  getRateLimitProvider,
  resetRateLimitProviderForTest,
} from "@/lib/server/rate-limit";

function headers(map: Record<string, string>) {
  return { get: (n: string) => map[n.toLowerCase()] ?? null };
}

describe("MemoryRateLimitProvider(固定窗口)", () => {
  it("窗口内超限拒绝,新窗口重置", async () => {
    const p = new MemoryRateLimitProvider();
    const t0 = 1_000_000;
    for (let i = 1; i <= 3; i++) {
      expect((await p.consume({ key: "k", limit: 3, windowMs: 60_000, now: t0 + i })).allowed).toBe(true);
    }
    expect((await p.consume({ key: "k", limit: 3, windowMs: 60_000, now: t0 + 4 })).allowed).toBe(false);
    // 下一个窗口重新放行
    expect((await p.consume({ key: "k", limit: 3, windowMs: 60_000, now: t0 + 60_000 })).allowed).toBe(true);
  });

  it("不同 key 互不影响;活跃桶不被逐出(P2-5 回归)", async () => {
    const p = new MemoryRateLimitProvider();
    const t0 = 2_000_000;
    // 打满 hot key
    for (let i = 0; i < 5; i++) await p.consume({ key: "hot", limit: 5, windowMs: 60_000, now: t0 });
    // 大量其它 key 涌入(旧实现 FIFO 会把 hot 挤掉导致计数清零)
    for (let i = 0; i < 6000; i++) await p.consume({ key: `k${i}`, limit: 5, windowMs: 60_000, now: t0 });
    const r = await p.consume({ key: "hot", limit: 5, windowMs: 60_000, now: t0 });
    expect(r.allowed).toBe(false); // hot 仍被记住,第 6 次拒绝
  });
});

describe("provider 选择", () => {
  const saved = process.env.RATE_LIMIT_PROVIDER;
  afterEach(() => {
    if (saved === undefined) delete process.env.RATE_LIMIT_PROVIDER;
    else process.env.RATE_LIMIT_PROVIDER = saved;
    resetRateLimitProviderForTest();
  });

  it("RATE_LIMIT_PROVIDER=memory 显式生效;非生产缺省 memory", () => {
    process.env.RATE_LIMIT_PROVIDER = "memory";
    resetRateLimitProviderForTest();
    expect(getRateLimitProvider()).toBeInstanceOf(MemoryRateLimitProvider);
    delete process.env.RATE_LIMIT_PROVIDER;
    resetRateLimitProviderForTest();
    // vitest 下 NODE_ENV=test → memory
    expect(getRateLimitProvider()).toBeInstanceOf(MemoryRateLimitProvider);
  });
});

describe("clientIpFromHeaders(可信跳数模型)", () => {
  it("单层可信代理:取最右段;客户端伪造段在更左侧,取不到", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }), 1)).toBe("1.2.3.4");
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "1.2.3.4" }), 1)).toBe("1.2.3.4");
  });

  it("两层可信代理:右起第 2 段", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "spoof, 1.2.3.4, 10.0.0.1" }), 2)).toBe("1.2.3.4");
  });

  it("hops=0(直连):完全不信任转发头", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "6.6.6.6" }), 0)).toBeNull();
    expect(clientIpFromHeaders(headers({ "x-real-ip": "6.6.6.6" }), 0)).toBeNull();
  });

  it("段数不足可信跳数 → 不信任(返回 null)", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "1.2.3.4" }), 2)).toBeNull();
  });

  it("规范化:IPv4 去端口、IPv4-mapped 剥前缀、IPv6 方括号", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "1.2.3.4:5678" }), 1)).toBe("1.2.3.4");
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "::ffff:1.2.3.4" }), 1)).toBe("1.2.3.4");
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "[2001:db8::1]:443" }), 1)).toBe("2001:db8::1");
  });

  it("无任何头 → null(调用方退化为全局键)", () => {
    expect(clientIpFromHeaders(headers({}), 1)).toBeNull();
  });
});
