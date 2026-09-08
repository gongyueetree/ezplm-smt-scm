/**
 * R3-6:Lab 数据集就绪度客户端。
 * env 未配置 → not_configured(不发请求);正常 → 计数映射;失败 → error 带人话。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLabDatasetSummary } from "@/lib/providers/erp/lab/dataset";

const ENV_KEYS = ["ERP_LAB_BASE_URL", "ERP_LAB_ACCESS_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("fetchLabDatasetSummary", () => {
  it("env 未配置 → not_configured,且**不发任何请求**", async () => {
    delete process.env.ERP_LAB_BASE_URL;
    delete process.env.ERP_LAB_ACCESS_TOKEN;
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await fetchLabDatasetSummary(null);
    expect(r.state).toBe("not_configured");
    expect(r.dataset).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("正常:健康 + 数据集行数映射;租户走 erpLabTenantId", async () => {
    process.env.ERP_LAB_BASE_URL = "https://lab.example";
    process.env.ERP_LAB_ACCESS_TOKEN = "tok";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes("/api/health")) {
          return new Response(JSON.stringify({ ok: true, version: "2.3.0", latencyMs: 42 }));
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              datasetName: "primatronics-uat",
              tenantId: "primatronics-uat",
              version: 7,
              seededAt: "2026-09-08T01:00:00Z",
              scenario: { scenario: "NORMAL" },
              materials: [{}, {}],
              inventory: [{}],
              excess: [],
              suppliers: [{}],
              customers: [{}, {}, {}],
              exchangeRates: [],
              purchaseOrders: [{}],
              receipts: [],
              workOrders: [],
              salesOrders: [],
              mappingProfiles: [{}],
            },
          }),
        );
      }),
    );
    const r = await fetchLabDatasetSummary("primatronics-uat");
    expect(r.state).toBe("ok");
    expect(calls.some((u) => u.includes("tenantId=primatronics-uat"))).toBe(true);
    expect(r.health).toEqual({ ok: true, version: "2.3.0", latencyMs: 42 });
    expect(r.dataset).toMatchObject({
      datasetName: "primatronics-uat",
      version: 7,
      scenario: "NORMAL",
      mappingProfiles: 1,
    });
    expect(r.dataset!.counts["物料"]).toBe(2);
    expect(r.dataset!.counts["客户"]).toBe(3);
  });

  it("Lab 4xx/形状不符 → error 带人话原因(不假成功)", async () => {
    process.env.ERP_LAB_BASE_URL = "https://lab.example";
    process.env.ERP_LAB_ACCESS_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const r = await fetchLabDatasetSummary(null);
    expect(r.state).toBe("error");
    expect(r.note).toContain("401");
    expect(r.dataset).toBeNull();
  });
});
