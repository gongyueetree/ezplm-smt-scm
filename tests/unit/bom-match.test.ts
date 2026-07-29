import { describe, expect, it } from "vitest";
import {
  LOCAL_HIT_CONFIDENCE,
  SOURCE_CONFIDENCE,
  describeSimilarity,
  matchBomLine,
  matchBomLines,
  type LocalPartRef,
  type MatchContext,
} from "@/lib/domain/bom-match";
import type { ParsedBomLine } from "@/lib/domain/bom-parse";
import { MockEzplmProvider } from "@/lib/providers/ezplm";
import { MockDigiKeyProvider } from "@/lib/providers/digikey";
import { MockMouserProvider } from "@/lib/providers/mouser";
import { ProviderError } from "@/lib/providers/common/errors";
import type { DistributorProvider } from "@/lib/providers/common/distributor";

function line(patch: Partial<ParsedBomLine>): ParsedBomLine {
  return {
    sourceRow: 1,
    lineNo: 1,
    refDes: "R1",
    qty: 1000,
    mpn: null,
    manufacturer: null,
    customerPn: null,
    internalPn: null,
    description: null,
    footprint: null,
    issues: [],
    ...patch,
  };
}

const localPart: LocalPartRef = {
  partId: "p-1",
  internalPn: "QC-IC-0001",
  mpn: "STM32F103C8T6",
  manufacturer: "STMicroelectronics",
  footprint: "LQFP-48",
  lifecycle: "ACTIVE",
  description: "MCU ARM Cortex-M3 64KB Flash LQFP-48",
  stockQty: 1200,
  slowMovingQty: 0,
  opoQty: 500,
  eta: "2026-08-10T00:00:00.000Z",
  dataUpdatedAt: "2026-07-20T08:00:00.000Z",
};

const localCtx: MatchContext = {
  customerMappings: new Map([
    [
      "LCM3201",
      { customerPn: "LC-M-3201", internalPn: "QC-IC-0001", mpn: "STM32F103C8T6", manufacturer: "STMicroelectronics" },
    ],
  ]),
  byInternalPn: new Map([["QCIC0001", localPart]]),
  byMpn: new Map([["STM32F103C8T6", [localPart]]]),
  allParts: [localPart],
};

describe("匹配顺序(SPEC §6)", () => {
  it("① 客户料号映射命中,置信度最高", async () => {
    const r = await matchBomLine(line({ customerPn: "LC-M-3201" }), localCtx);
    expect(r.candidates[0].source).toBe("CUSTOMER_MAPPING");
    expect(r.candidates[0].confidence).toBe(SOURCE_CONFIDENCE.CUSTOMER_MAPPING);
    expect(r.candidates[0].partId).toBe("p-1");
  });

  it("② 内部料号命中", async () => {
    const r = await matchBomLine(line({ internalPn: "QC-IC-0001" }), localCtx);
    expect(r.candidates[0].source).toBe("INTERNAL_PN");
  });

  it("③ 精确 MPN 命中(无制造商时)", async () => {
    const r = await matchBomLine(line({ mpn: "STM32F103C8T6" }), localCtx);
    expect(r.candidates[0].source).toBe("EXACT_MPN");
  });

  it("④ Manufacturer + MPN 同时命中时置信度更高", async () => {
    const r = await matchBomLine(
      line({ mpn: "STM32F103C8T6", manufacturer: "STMicroelectronics" }),
      localCtx,
    );
    expect(r.candidates[0].source).toBe("MFR_MPN");
    expect(r.candidates[0].confidence).toBeGreaterThan(SOURCE_CONFIDENCE.EXACT_MPN);
  });

  it("⑤ 描述模糊匹配:置信度按相似度缩放,且低于精确匹配", async () => {
    const r = await matchBomLine(
      line({ description: "MCU ARM Cortex-M3 64KB Flash LQFP-48" }),
      localCtx,
    );
    expect(r.candidates[0].source).toBe("DESCRIPTION");
    expect(r.candidates[0].confidence).toBeLessThan(SOURCE_CONFIDENCE.EXACT_MPN);
    expect(r.candidates[0].confidence).toBeGreaterThan(0);
  });

  it("描述相似但封装不符时不作为候选(避免错料)", async () => {
    const r = await matchBomLine(
      line({ description: "MCU ARM Cortex-M3 64KB Flash LQFP-48", footprint: "QFN-32" }),
      localCtx,
    );
    expect(r.candidates).toEqual([]);
  });

  it("⑧ 任何情况下都要求人工确认(AI 不定案)", async () => {
    const hit = await matchBomLine(line({ customerPn: "LC-M-3201" }), localCtx);
    const miss = await matchBomLine(line({ mpn: "NO-SUCH" }), localCtx);
    expect(hit.requiresManualDecision).toBe(true);
    expect(miss.requiresManualDecision).toBe(true);
  });
});

describe("三方候选(⑥⑦)与配额保护", () => {
  const externalCtx: MatchContext = {
    ...localCtx,
    ezplm: new MockEzplmProvider(),
    distributors: [new MockDigiKeyProvider(), new MockMouserProvider()],
  };

  it("本地已高置信命中时不调用三方(省配额)", async () => {
    let called = 0;
    const spy: DistributorProvider = {
      name: "DIGIKEY",
      getOffersByMpn: async () => {
        called += 1;
        return [];
      },
      searchCandidates: async () => [],
      getSubstitutes: async () => [],
      getRecommended: async () => [],
    };
    const r = await matchBomLine(line({ mpn: "STM32F103C8T6" }), {
      ...localCtx,
      distributors: [spy],
    });
    expect(r.candidates[0].confidence).toBeGreaterThanOrEqual(LOCAL_HIT_CONFIDENCE);
    expect(called).toBe(0);
  });

  it("本地无命中时,ezPLM 与分销商候选都进入结果并带价格与数据更新时间", async () => {
    const r = await matchBomLine(line({ mpn: "MAX3232EIDR", qty: 1000 }), {
      ezplm: externalCtx.ezplm,
      distributors: externalCtx.distributors,
    });
    const sources = r.candidates.map((c) => c.source);
    expect(sources).toContain("EZPLM");
    expect(sources).toContain("DIGIKEY");
    expect(sources).toContain("MOUSER");

    const dk = r.candidates.find((c) => c.source === "DIGIKEY")!;
    expect(dk.price).toBe("7.6"); // 1000 档
    expect(dk.currency).toBe("CNY");
    expect(dk.stockQty).toBe(18000);
    expect(dk.dataUpdatedAt).toBeTruthy();
  });

  it("候选按置信度降序,来源顺序稳定", async () => {
    const r = await matchBomLine(line({ mpn: "MAX3232EIDR" }), {
      ezplm: externalCtx.ezplm,
      distributors: externalCtx.distributors,
    });
    const conf = r.candidates.map((c) => c.confidence);
    expect(conf).toEqual([...conf].sort((a, b) => b - a));
  });

  it("三方不可用时记 degraded,不抛错、不阻断整张 BOM(SPEC §8)", async () => {
    const dead: DistributorProvider = {
      name: "MOUSER",
      getOffersByMpn: async () => {
        throw new ProviderError("MOUSER", "quota_exceeded", "Mouser 当日配额已用尽");
      },
      searchCandidates: async () => [],
      getSubstitutes: async () => [],
      getRecommended: async () => [],
    };
    const r = await matchBomLine(line({ mpn: "MAX3232EIDR" }), {
      ezplm: externalCtx.ezplm,
      distributors: [new MockDigiKeyProvider(), dead],
    });
    expect(r.degraded).toHaveLength(1);
    expect(r.degraded[0]).toMatchObject({ provider: "MOUSER", kind: "quota_exceeded" });
    // DigiKey 的候选仍然拿到了
    expect(r.candidates.some((c) => c.source === "DIGIKEY")).toBe(true);
  });
});

describe("批量匹配:相同 MPN 只查一次三方", () => {
  it("重复 MPN 复用结果(配额敏感)", async () => {
    let calls = 0;
    const counting: DistributorProvider = {
      name: "DIGIKEY",
      getOffersByMpn: async () => {
        calls += 1;
        return [];
      },
      searchCandidates: async () => [],
      getSubstitutes: async () => [],
      getRecommended: async () => [],
    };
    const lines = [
      line({ lineNo: 1, mpn: "SAME-MPN" }),
      line({ lineNo: 2, mpn: "SAME-MPN" }),
      line({ lineNo: 3, mpn: "OTHER-MPN" }),
    ];
    const results = await matchBomLines(lines, { distributors: [counting] });
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.lineNo)).toEqual([1, 2, 3]);
    expect(calls).toBe(2);
  });
});

describe("描述相似度", () => {
  it("完全相同为 1,毫不相干为 0", () => {
    expect(describeSimilarity("CAP CER 0.1UF 50V", "CAP CER 0.1UF 50V")).toBe(1);
    expect(describeSimilarity("电容 0.1uF", "连接器 2.54mm")).toBe(0);
  });

  it("空值安全", () => {
    expect(describeSimilarity(null, "x")).toBe(0);
    expect(describeSimilarity("x", null)).toBe(0);
  });
});

describe("相似度候选:工程 BOM 只有 Value 时的主力路径", () => {
  const LOCAL = [
    { partId: "p1", internalPn: "EZP-MIC5504-1.2YM5-TR", mpn: "MIC5504-1.2YM5-TR", manufacturer: "Microchip Technology Inc.", footprint: "SOT-23-5", lifecycle: "ACTIVE" as const, description: "300mA LDO", stockQty: null, slowMovingQty: null, opoQty: null, eta: null, dataUpdatedAt: null },
    { partId: "p2", internalPn: "EZP-STM32F103C8T6", mpn: "STM32F103C8T6", manufacturer: "STMicroelectronics", footprint: "TQFP-48_7x7mm_P0.5mm", lifecycle: "ACTIVE" as const, description: "MCU", stockQty: null, slowMovingQty: null, opoQty: null, eta: null, dataUpdatedAt: null },
  ];

  const line = (over: Record<string, unknown> = {}) => ({
    sourceRow: 2, lineNo: 1, refDes: "U1", qty: 1, mpn: null, manufacturer: null,
    customerPn: null, internalPn: null, description: null, footprint: null, issues: [], ...over,
  });

  it("本地库能给出同系列候选,并带上判断依据", async () => {
    const r = await matchBomLine(
      line({ mpn: "MIC5504-3.3", packageCode: "SOT-23-5" }) as never,
      { allParts: LOCAL },
    );
    const hit = r.candidates.find((c) => c.source === "LOCAL_SIMILAR");
    expect(hit?.mpn).toBe("MIC5504-1.2YM5-TR");
    expect(hit?.matchReason).toContain("MIC5504");
    expect(hit?.matchReason).toContain("封装完全一致");
  });

  it("**本地库优先于 ezPLM**:自家料号才是能直接下单的", () => {
    expect(SOURCE_CONFIDENCE.LOCAL_SIMILAR).toBeGreaterThan(SOURCE_CONFIDENCE.EZPLM_SIMILAR);
  });

  it("相似度候选一律低于精确命中,不会盖过确切结果", () => {
    expect(SOURCE_CONFIDENCE.LOCAL_SIMILAR).toBeLessThan(SOURCE_CONFIDENCE.EXACT_MPN);
    expect(SOURCE_CONFIDENCE.EZPLM_SIMILAR).toBeLessThan(SOURCE_CONFIDENCE.EZPLM);
  });

  it("同一 MPN 既有精确命中又有相似候选时,只保留精确的(避免同一颗料出现两次)", async () => {
    const r = await matchBomLine(
      line({ mpn: "STM32F103C8T6", packageCode: "TQFP-48" }) as never,
      { allParts: LOCAL, byMpn: new Map([["STM32F103C8T6", [LOCAL[1]]]]) },
    );
    const same = r.candidates.filter((c) => c.mpn === "STM32F103C8T6");
    expect(same).toHaveLength(1);
    expect(same[0].source).toBe("EXACT_MPN");
  });

  it("完全不相干的 Value 不产生候选 —— 宁可说没有,也不塞无关型号", async () => {
    const r = await matchBomLine(line({ mpn: "完全不相干XYZ123" }) as never, { allParts: LOCAL });
    expect(r.candidates).toEqual([]);
  });

  it("正式匹配恒需人工确认", async () => {
    const r = await matchBomLine(line({ mpn: "MIC5504-3.3" }) as never, { allParts: LOCAL });
    expect(r.requiresManualDecision).toBe(true);
  });
});
