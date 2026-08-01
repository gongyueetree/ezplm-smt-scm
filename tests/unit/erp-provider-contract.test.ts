import { describe, expect, it } from "vitest";
import { getErpProvider } from "@/lib/providers/erp";
import {
  ConnectionTestResultSchema,
  ErpMetadataSchema,
  ErpNotConfiguredError,
  ErpNotImplementedError,
  type ErpConnectionConfig,
} from "@/lib/providers/erp/types";

const VENDORS = ["MOCK", "EXCEL", "KINGDEE", "YONYOU", "SAP", "ORACLE"] as const;

function cfg(vendor: string, over: Partial<ErpConnectionConfig> = {}): ErpConnectionConfig {
  return { vendor, edition: null, config: {}, secrets: {}, ...over };
}

describe("ErpProvider 合同:所有实现必须满足同一份契约", () => {
  it.each(VENDORS)("%s:testConnection 返回结构合法", async (v) => {
    const r = await getErpProvider(v).testConnection(cfg(v));
    expect(ConnectionTestResultSchema.safeParse(r).success).toBe(true);
  });

  it.each(VENDORS)("%s:getMetadata 返回结构合法且列明未实现项", async (v) => {
    const m = await getErpProvider(v).getMetadata(cfg(v));
    expect(ErpMetadataSchema.safeParse(m).success).toBe(true);
    expect(Array.isArray(m.notImplemented)).toBe(true);
  });

  it("未知厂商回落到 Mock,而不是抛错让整页崩掉", () => {
    expect(getErpProvider("NOT_A_VENDOR").vendor).toBe("MOCK");
  });
});

describe("诚实纪律:未联调 ≠ 没数据", () => {
  it.each(["YONYOU", "SAP", "ORACLE"] as const)(
    "%s 的能力**抛 NotImplemented**,绝不返回空数组冒充「同步完成 0 条」",
    async (v) => {
      const p = getErpProvider(v);
      await expect(p.pullMaterials(cfg(v), {})).rejects.toBeInstanceOf(ErpNotImplementedError);
      await expect(p.pullInventory(cfg(v), {})).rejects.toBeInstanceOf(ErpNotImplementedError);
      await expect(p.pushEtaUpdates(cfg(v), [])).rejects.toBeInstanceOf(ErpNotImplementedError);
    },
  );

  it.each(["YONYOU", "SAP", "ORACLE"] as const)("%s 的 testConnection 永远 ok=false 并给出建议", async (v) => {
    const r = await getErpProvider(v).testConnection(cfg(v));
    expect(r.ok).toBe(false);
    expect(r.failureReason).toContain("尚未联调");
    expect(r.suggestion).toBeTruthy();
  });

  it("**缺凭据的金蝶不发任何请求**,直接返回待联调原因与可操作建议", async () => {
    const r = await getErpProvider("KINGDEE").testConnection(cfg("KINGDEE"));
    expect(r.ok).toBe(false);
    expect(r.responseMs).toBe(0); // 没发请求
    expect(r.failureReason).toContain("缺少必填项");
    expect(r.suggestion).toContain("不会回传明文");
  });

  it("金蝶缺凭据时调 pull 抛 NotConfigured(与 NotImplemented 区分开)", async () => {
    await expect(getErpProvider("KINGDEE").pullMaterials(cfg("KINGDEE"), {})).rejects.toBeInstanceOf(
      ErpNotConfiguredError,
    );
  });

  it("Mock 连通也要说明「不代表任何真实 ERP 已接通」", async () => {
    const r = await getErpProvider("MOCK").testConnection(cfg("MOCK"));
    expect(r.ok).toBe(true);
    expect(r.suggestion).toContain("不代表任何真实 ERP");
  });

  it("**推送结果必须区分「已产出模板」与「已写入 ERP」**", async () => {
    const r = await getErpProvider("EXCEL").pushPurchaseOrders(cfg("EXCEL"), []);
    expect(r.writtenToErp).toBe(false);
    expect(r.note).toContain("不代表 ERP 已接单");

    const m = await getErpProvider("MOCK").pushPurchaseOrders(cfg("MOCK"), []);
    expect(m.writtenToErp).toBe(false);
  });
});

describe("Excel 通道:一期真实可用", () => {
  it("读的是用户上传的表格,不是任何 ERP 接口", async () => {
    const uploaded = {
      MATERIAL: [{ externalId: "1", internalPn: "P1", mpn: "M1", manufacturer: null, description: null, footprint: null, unit: null, moq: null, spq: null, leadTimeDays: null, lifecycle: null, status: null, updatedAt: null }],
    };
    const r = await getErpProvider("EXCEL").pullMaterials(
      cfg("EXCEL", { config: { uploadedRows: uploaded } }),
      {},
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].internalPn).toBe("P1");
  });

  it("没上传就是 0 条,不编造数据", async () => {
    const r = await getErpProvider("EXCEL").pullMaterials(cfg("EXCEL"), {});
    expect(r.items).toEqual([]);
  });

  it("测试连接如实说明这条通道不连任何系统", async () => {
    const r = await getErpProvider("EXCEL").testConnection(cfg("EXCEL"));
    expect(r.suggestion).toContain("不连接任何 ERP");
  });
});
