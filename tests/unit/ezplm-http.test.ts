import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpEzplmProvider } from "@/lib/providers/ezplm/http";
import { ProviderError } from "@/lib/providers/common/errors";
import {
  FIXTURE_API_KEY,
  FIXTURE_PARTS,
  startEzplmFixture,
  type FixtureServer,
} from "./helpers/ezplm-fixture-server";

let server: FixtureServer;

beforeAll(async () => {
  server = await startEzplmFixture();
});
afterAll(async () => {
  await server.close();
});

function makeProvider(extra: Partial<ConstructorParameters<typeof HttpEzplmProvider>[0]> = {}) {
  return new HttpEzplmProvider({
    baseUrl: server.origin,
    apiKey: FIXTURE_API_KEY,
    retryBaseMs: 1,
    sleep: () => Promise.resolve(),
    ...extra,
  });
}

describe("签名与鉴权(夹具服务独立重算签名校验)", () => {
  it("按手册算法签名的请求被接受", async () => {
    const p = makeProvider();
    const parts = await p.searchParts({ keyword: "STM32" });
    expect(parts.length).toBeGreaterThan(0);
  });

  it("错误 API Key 被拒并抛 auth 结构化错误", async () => {
    const p = makeProvider({ apiKey: "wrong-key" });
    await expect(p.searchParts({ keyword: "STM32" })).rejects.toMatchObject({
      name: "ProviderError",
      provider: "EZPLM",
      kind: "auth",
    });
  });

  it("每次请求使用新的一次性 Nonce(防重放)", async () => {
    const p = makeProvider();
    const before = server.requests.length;
    await p.searchParts({ keyword: "STM32" });
    await p.searchParts({ keyword: "STM32" });
    const nonces = server.requests.slice(before).map((r) => r.nonce);
    expect(nonces).toHaveLength(2);
    expect(nonces[0]).not.toBe(nonces[1]);
    expect(nonces.every(Boolean)).toBe(true);
  });
});

describe("真实响应结构映射", () => {
  it("searchParts 映射 MPN / 制造商 / 描述 / 封装名", async () => {
    const p = makeProvider();
    const parts = await p.searchParts({ keyword: "STM32F103" });
    const hit = parts.find((x) => x.mpn === "STM32F103C8T6")!;
    expect(hit.manufacturer).toBe("STMicroelectronics");
    expect(hit.description).toContain("Cortex-M3");
    expect(hit.footprint).toBe("LQFP-48_7x7mm_P0.5mm");
  });

  it("ezPLM 未提供的字段一律 null / UNKNOWN,绝不臆测填充", async () => {
    const p = makeProvider();
    const hit = (await p.getPartByMpn({ mpn: "STM32F103C8T6" }))!;
    expect(hit.internalPn).toBeNull();
    expect(hit.lifecycle).toBe("UNKNOWN");
    expect(hit.rohs).toBeNull();
    expect(hit.reach).toBeNull();
    expect(hit.msl).toBeNull();
    expect(hit.dateCode).toBeNull();
  });

  it("getPartByMpn 精确匹配 MPN,不返回相近型号", async () => {
    const p = makeProvider();
    expect((await p.getPartByMpn({ mpn: "STM32F103C8T6" }))?.mpn).toBe("STM32F103C8T6");
    expect(await p.getPartByMpn({ mpn: "NO-SUCH-MPN" })).toBeNull();
  });

  it("详情一次取回 基本信息 + 参数 + 文档(省配额)", async () => {
    const p = makeProvider();
    const detail = (await p.getPartDetailByMpn("STM32F103C8T6"))!;
    expect(detail.part.mpn).toBe("STM32F103C8T6");
    expect(detail.parameters.map((x) => x.name)).toContain("供电电压");
    const kinds = detail.documents.map((d) => d.kind);
    expect(kinds).toContain("DATASHEET");
    expect(kinds).toContain("SYMBOL");
    expect(kinds).toContain("FOOTPRINT");
    expect(kinds).toContain("MODEL_3D");
  });

  it("缺文件/缺参数的物料不报错,只是文档与参数为空", async () => {
    const p = makeProvider();
    const detail = (await p.getPartDetailByMpn("STM32C011F4P7"))!;
    expect(detail.documents).toEqual([]);
    expect(detail.parameters).toEqual([]);
  });

  it("参考设计按 partlibId 查询", async () => {
    const p = makeProvider();
    const refs = await p.getReferenceDesigns(FIXTURE_PARTS[0].id);
    expect(refs[0].name).toContain("参考设计");
    expect(await p.getReferenceDesigns("not-exist")).toEqual([]);
  });
});

describe("能力边界:该 API 不提供的功能必须如实报错", () => {
  it.each([
    ["库存", (p: HttpEzplmProvider) => p.getInventory(["x"])],
    ["客户料号映射", (p: HttpEzplmProvider) => p.getCustomerMappings("c1")],
    ["替代料", (p: HttpEzplmProvider) => p.getAlternates("x")],
    ["合规", (p: HttpEzplmProvider) => p.getCompliance("x")],
  ])("%s 抛 not_supported,而不是返回空数组冒充查到了", async (_label, call) => {
    const p = makeProvider();
    await expect(call(p)).rejects.toMatchObject({ kind: "not_supported" });
  });
});

describe("配额与容错", () => {
  it("429 直接抛 quota_exceeded 且不重试(重试只会更快耗尽配额)", async () => {
    const p = makeProvider();
    server.forceStatus = 429;
    const before = server.requests.length;
    await expect(p.searchParts({ keyword: "STM32" })).rejects.toMatchObject({
      kind: "quota_exceeded",
    });
    expect(server.requests.length - before).toBe(1);
  });

  it("5xx 退避重试后成功", async () => {
    const p = makeProvider();
    server.forceStatus = 503;
    const parts = await p.searchParts({ keyword: "STM32" });
    expect(parts.length).toBeGreaterThan(0);
  });

  it("响应结构不符合契约时抛 validation", async () => {
    const p = makeProvider({
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ nope: 1 }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    await expect(p.searchParts({ keyword: "x" })).rejects.toMatchObject({ kind: "validation" });
  });

  it("配置了多余路径与 http 时给出警告并自行纠正", () => {
    const p = new HttpEzplmProvider({
      baseUrl: "http://www.ezplm.cn/api/v1/api-",
      apiKey: FIXTURE_API_KEY,
    });
    expect(p.configWarnings.join()).toContain("https");
    expect(p.configWarnings.join()).toContain("已忽略");
  });

  it("ProviderError 的安全摘要不含 API Key", async () => {
    const p = makeProvider({ apiKey: "super-secret-key" });
    try {
      await p.searchParts({ keyword: "STM32" });
      throw new Error("应当抛错");
    } catch (e) {
      const safe = JSON.stringify((e as ProviderError).toSafeJSON());
      expect(safe).not.toContain("super-secret-key");
    }
  });
});
