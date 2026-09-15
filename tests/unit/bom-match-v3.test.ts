/**
 * R4-5(§27/§28/§32/§54):BOM Matching v3。
 * 乾创 MFG 映射通道 / PO_HISTORY 封顶 / PATTERN 排除 / PCB 分流 /
 * 一厂多料多候选 / 20K/50K 内存规模(第 19,999 号照样命中)。
 */
import { describe, expect, it } from "vitest";
import {
  matchBomLine,
  type LocalPartRef,
  type MatchContext,
  type MfgMappingRef,
} from "@/lib/domain/bom-match";

function part(partId: string, internalPn: string, mpn: string | null = null): LocalPartRef {
  return {
    partId,
    internalPn,
    mpn,
    manufacturer: null,
    footprint: null,
    lifecycle: null,
    description: null,
    stockQty: null,
    slowMovingQty: null,
    opoQty: null,
    eta: null,
    dataUpdatedAt: null,
  };
}

function mapping(over: Partial<MfgMappingRef> & Pick<MfgMappingRef, "partId" | "internalPn" | "manufacturerPartNo">): MfgMappingRef {
  return {
    rawManufacturer: null,
    canonicalManufacturerId: null,
    canonicalManufacturerName: null,
    relationType: "MAINTAINED",
    status: "CANDIDATE",
    mappingSource: "ERP_MFG_MAINTENANCE",
    identifierKind: "COMPONENT_MPN",
    identifierMatchMode: "EXACT",
    ...over,
  };
}

const line = (over: Record<string, unknown>) => ({
  sourceRow: 1,
  lineNo: 1,
  refDes: "R1",
  qty: 100,
  mpn: null,
  manufacturer: null,
  customerPn: null,
  internalPn: null,
  description: null,
  footprint: null,
  issues: [],
  ...over,
});

describe("§27 乾创 MFG 映射通道", () => {
  const p1 = part("p1", "10-01-0001");
  const p2 = part("p2", "10-01-0002");
  const ctx: MatchContext = {
    byPartId: new Map([
      ["p1", p1],
      ["p2", p2],
    ]),
    mfgByMpnKey: new Map([
      [
        "GRM155R71C104KA88D",
        [
          mapping({ partId: "p1", internalPn: "10-01-0001", manufacturerPartNo: "GRM155R71C104KA88D", canonicalManufacturerId: "cmr_murata", canonicalManufacturerName: "Murata" }),
          mapping({ partId: "p2", internalPn: "10-01-0002", manufacturerPartNo: "GRM155R71C104KA88D" }),
        ],
      ],
    ]),
    materialKindByPartId: new Map([
      ["p1", "ELECTRONIC_COMPONENT"],
      ["p2", "ELECTRONIC_COMPONENT"],
    ]),
  };

  it("一厂多料:同一 MPN 命中两个内部料 → 两个候选,人工裁决(§27)", async () => {
    const r = await matchBomLine(line({ mpn: "GRM155R71C104KA88D" }) as never, ctx);
    const qc = r.candidates.filter((c) => c.source === "QC_MFG_MPN");
    expect(qc).toHaveLength(2);
    expect(new Set(qc.map((c) => c.partId))).toEqual(new Set(["p1", "p2"]));
    expect(r.requiresManualDecision).toBe(true);
  });

  it("厂商对齐(canonical id 经 resolveMfr)→ QC_MFG_MFR_MPN 0.96", async () => {
    const r = await matchBomLine(line({ mpn: "GRM155R71C104KA88D", manufacturer: "muRata" }) as never, {
      ...ctx,
      resolveMfr: () => ({ id: "cmr_murata", name: "Murata" }),
    });
    const top = r.candidates[0];
    expect(top.source).toBe("QC_MFG_MFR_MPN");
    expect(top.partId).toBe("p1");
    expect(top.confidence).toBeCloseTo(0.96, 2);
  });

  it("§22:PO_HISTORY CANDIDATE 置信度封顶 0.75(不达批量确认线)", async () => {
    const r = await matchBomLine(line({ mpn: "STM32F103C8T6" }) as never, {
      byPartId: new Map([["p1", p1]]),
      mfgByMpnKey: new Map([
        ["STM32F103C8T6", [mapping({ partId: "p1", internalPn: "10-01-0001", manufacturerPartNo: "STM32F103C8T6", mappingSource: "PO_HISTORY", relationType: "HISTORICAL", status: "CANDIDATE" })]],
      ]),
      materialKindByPartId: new Map([["p1", "ELECTRONIC_COMPONENT"]]),
    });
    expect(r.candidates[0].confidence).toBeLessThanOrEqual(0.75);
    expect(r.candidates[0].matchReason).toContain("PO 历史证据");
  });

  it("§10:PATTERN 映射不参与 exact 匹配", async () => {
    const r = await matchBomLine(line({ mpn: "CC0402KRX5R" }) as never, {
      byPartId: new Map([["p1", p1]]),
      mfgByMpnKey: new Map([
        ["CC0402KRX5R", [mapping({ partId: "p1", internalPn: "10-01-0001", manufacturerPartNo: "CC0402*", identifierMatchMode: "PATTERN" })]],
      ]),
    });
    expect(r.candidates.filter((c) => c.source.startsWith("QC_MFG"))).toHaveLength(0);
  });

  it("内部料号命中 → mfgParts 关系组随行返回(一料多厂展示)", async () => {
    const r = await matchBomLine(line({ internalPn: "10-01-0001" }) as never, {
      byInternalPn: new Map([["10010001", p1]]),
      mfgByPartId: new Map([
        [
          "p1",
          [
            mapping({ partId: "p1", internalPn: "10-01-0001", manufacturerPartNo: "GRM155R71C104KA88D" }),
            mapping({ partId: "p1", internalPn: "10-01-0001", manufacturerPartNo: "CL05B104KO5NNNC" }),
          ],
        ],
      ]),
      materialKindByPartId: new Map([["p1", "ELECTRONIC_COMPONENT"]]),
    });
    expect(r.mfgParts).toHaveLength(2);
    expect(r.routing).toBe("COMPONENT");
  });
});

describe("§28 PCB 分流", () => {
  it("命中 PCB 裸板 → NON_COMPONENT,跳过 ezPLM/DigiKey/Mouser(不发调用)", async () => {
    let ezplmCalled = 0;
    let distCalled = 0;
    const pcb = part("pcb1", "20-02-0002");
    const r = await matchBomLine(line({ internalPn: "20-02-0002", mpn: "PCB-XX-01" }) as never, {
      byInternalPn: new Map([["20020002", pcb]]),
      materialKindByPartId: new Map([["pcb1", "PCB_BARE_BOARD"]]),
      ezplm: {
        getPartByMpn: async () => {
          ezplmCalled++;
          return null;
        },
        searchParts: async () => {
          ezplmCalled++;
          return [];
        },
      } as never,
      distributors: [
        {
          name: "DIGIKEY",
          getOffersByMpn: async () => {
            distCalled++;
            return [];
          },
        } as never,
      ],
    });
    expect(r.routing).toBe("NON_COMPONENT");
    expect(ezplmCalled).toBe(0);
    expect(distCalled).toBe(0);
    expect(r.degraded.some((d) => d.kind === "NON_COMPONENT_SKIP")).toBe(true);
  });

  it("未命中本地料 → UNKNOWN,保守走元器件通道", async () => {
    const r = await matchBomLine(line({ mpn: "UNKNOWN-MPN-1" }) as never, {});
    expect(r.routing).toBe("UNKNOWN");
  });
});

describe("§32/§54 规模(内存 20K 料 / 50K 映射)", () => {
  it("第 19,999 号料经内部料号与 MFG 映射均可命中;语料截断经 degraded 显式上报", async () => {
    const byInternalPn = new Map<string, LocalPartRef>();
    const byPartId = new Map<string, LocalPartRef>();
    const mfgByMpnKey = new Map<string, MfgMappingRef[]>();
    const kinds = new Map<string, string>();
    for (let i = 0; i < 20000; i++) {
      const pn = `PN-${String(i).padStart(6, "0")}`;
      const p = part(`p${i}`, pn);
      byInternalPn.set(pn.replace(/[^0-9A-Z]/gi, "").toUpperCase(), p);
      byPartId.set(`p${i}`, p);
      kinds.set(`p${i}`, "ELECTRONIC_COMPONENT");
      // 每料 2-3 个映射 ≈ 5 万
      for (let j = 0; j < 2 + (i % 2); j++) {
        const mpn = `MPN${i}X${j}`;
        mfgByMpnKey.set(mpn, [
          mapping({ partId: `p${i}`, internalPn: pn, manufacturerPartNo: mpn }),
        ]);
      }
    }
    const ctx: MatchContext = {
      byInternalPn,
      byPartId,
      mfgByMpnKey,
      materialKindByPartId: kinds,
      similarityCorpusTruncated: { loaded: 20000, total: 21000 },
    };
    const totalMappings = [...mfgByMpnKey.values()].reduce((a, v) => a + v.length, 0);
    expect(totalMappings).toBeGreaterThanOrEqual(50000);

    const r1 = await matchBomLine(line({ internalPn: "PN-019999" }) as never, ctx);
    expect(r1.candidates[0]?.partId).toBe("p19999");
    const r2 = await matchBomLine(line({ mpn: "MPN19999X1" }) as never, ctx);
    expect(r2.candidates[0]?.partId).toBe("p19999");
    expect(r2.degraded.some((d) => d.kind === "SIMILARITY_CORPUS_TRUNCATED")).toBe(true);
  });
});
