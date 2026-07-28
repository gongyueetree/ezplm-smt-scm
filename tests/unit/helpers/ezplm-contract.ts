/**
 * EzplmPartsProvider 合同测试断言集(SPEC §7 contract tests)。
 * Mock 与 Http 实现共用,保证行为同构 —— 业务代码可互换二者。
 */
import { describe, expect, it } from "vitest";
import type { EzplmPartsProvider } from "@/lib/providers/ezplm";
import {
  AlternatePartSchema,
  BatchResolveResultSchema,
  CanonicalPartSchema,
  ComplianceResultSchema,
  InventoryResultSchema,
} from "@/lib/providers/ezplm";

export function runEzplmProviderContract(
  name: string,
  makeProvider: () => Promise<EzplmPartsProvider> | EzplmPartsProvider,
) {
  describe(`EzplmPartsProvider 合同:${name}`, () => {
    it("searchParts:关键字命中且响应符合 CanonicalPart 契约", async () => {
      const p = await makeProvider();
      const rows = await p.searchParts({ keyword: "STM32" });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(() => CanonicalPartSchema.parse(r)).not.toThrow();
      expect(rows.some((r) => r.mpn === "STM32F103C8T6")).toBe(true);
    });

    it("searchParts:limit 生效", async () => {
      const p = await makeProvider();
      const rows = await p.searchParts({ keyword: "QC-", limit: 2 });
      expect(rows.length).toBeLessThanOrEqual(2);
    });

    it("getPartByMpn:精确命中;未知 MPN 返回 null", async () => {
      const p = await makeProvider();
      const hit = await p.getPartByMpn({ mpn: "STM32F103C8T6" });
      expect(hit?.internalPn).toBe("QC-IC-0001");
      expect(await p.getPartByMpn({ mpn: "NO-SUCH-MPN-XYZ" })).toBeNull();
    });

    it("batchResolve:逐条返回结果,匹配顺序 客户料号→内部料号→MPN(SPEC §6)", async () => {
      const p = await makeProvider();
      const results = await p.batchResolve([
        { customerPn: "LC-M-3201" },
        { internalPn: "QC-RC-0104" },
        { mpn: "MAX232CPE" },
        { mpn: "NO-SUCH-MPN-XYZ" },
      ]);
      expect(results).toHaveLength(4);
      for (const r of results) expect(() => BatchResolveResultSchema.parse(r)).not.toThrow();
      expect(results[0].part?.internalPn).toBe("QC-IC-0001");
      expect(results[0].confidence).toBeGreaterThan(results[2].confidence);
      expect(results[1].part?.mpn).toBe("GRM188R71H104KA93D");
      expect(results[2].part?.lifecycle).toBe("EOL");
      expect(results[3].part).toBeNull();
      expect(results[3].confidence).toBe(0);
    });

    it("getInventory:返回含呆滞数量的库存(只读缓存语义的数据形态)", async () => {
      const p = await makeProvider();
      const rows = await p.getInventory(["ezp-1002", "ezp-unknown"]);
      for (const r of rows) expect(() => InventoryResultSchema.parse(r)).not.toThrow();
      const grm = rows.find((r) => r.partId === "ezp-1002");
      expect(grm?.qtyOnHand).toBe(85000);
      expect(grm?.qtySlowMoving).toBe(12000);
      expect(rows.find((r) => r.partId === "ezp-unknown")).toBeUndefined();
    });

    it("getCustomerMappings:已知客户返回映射,未知客户返回空数组", async () => {
      const p = await makeProvider();
      const rows = await p.getCustomerMappings("cus-lianchuang");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].customerId).toBe("cus-lianchuang");
      expect(await p.getCustomerMappings("cus-nobody")).toEqual([]);
    });

    it("getAlternates:EOL 物料给出替代并符合契约", async () => {
      const p = await makeProvider();
      const alts = await p.getAlternates("ezp-1003");
      expect(alts.length).toBeGreaterThan(0);
      for (const a of alts) expect(() => AlternatePartSchema.parse(a)).not.toThrow();
      expect(alts[0].alternate.mpn).toBe("MAX3232EIDR");
    });

    it("getCompliance:返回 RoHS/REACH 状态(允许 null=未知,不伪造合规)", async () => {
      const p = await makeProvider();
      const c = await p.getCompliance("ezp-1003");
      expect(() => ComplianceResultSchema.parse(c)).not.toThrow();
      expect(c.rohs).toBe(false);
      expect(c.reach).toBeNull();
    });
  });
}
