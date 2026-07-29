import { describe, expect, it } from "vitest";
import {
  commonPrefixLength,
  footprintAgreement,
  mpnSimilarity,
  normalizeForCompare,
  rankBySimilarity,
  scoreSimilarity,
  trigramSimilarity,
} from "@/lib/domain/similarity";

describe("normalizeForCompare", () => {
  it("大写并去掉分隔符 —— 型号里的 - _ / 空格不承载区分度", () => {
    expect(normalizeForCompare("MIC5504-3.3")).toBe("MIC550433");
    expect(normalizeForCompare("mic5504-3.3")).toBe(normalizeForCompare("MIC5504-3.3"));
    expect(normalizeForCompare(null)).toBe("");
  });
});

describe("commonPrefixLength / trigramSimilarity", () => {
  it("公共前缀", () => {
    expect(commonPrefixLength("ABCDEF", "ABCXYZ")).toBe(3);
    expect(commonPrefixLength("ABC", "XYZ")).toBe(0);
  });

  it("三元组相似度:相同为 1,无关接近 0", () => {
    expect(trigramSimilarity("ABCDEF", "ABCDEF")).toBe(1);
    expect(trigramSimilarity("ABCDEF", "ZZZZZZ")).toBeLessThan(0.2);
    expect(trigramSimilarity("", "ABC")).toBe(0);
  });
});

describe("mpnSimilarity:前缀权重更高(型号家族信息在前缀里)", () => {
  it("完全相同为 1", () => {
    expect(mpnSimilarity("LM2776DBVR", "LM2776DBVR")).toBe(1);
    expect(mpnSimilarity("mic5504-3.3", "MIC55043.3")).toBe(1); // 归一后一致
  });

  it("短型号是长型号的前缀时得高分(工程 BOM 常只写到这一层)", () => {
    // 真实场景:BOM 里写 MIC5504-3.3,ezPLM 里是 MIC5504-3.3YM5-TR
    expect(mpnSimilarity("MIC5504-3.3", "MIC5504-3.3YM5-TR")).toBeGreaterThan(0.7);
    expect(mpnSimilarity("LM2776", "LM2776DBVR")).toBeGreaterThan(0.7);
  });

  it("同家族不同规格分数中等", () => {
    const s = mpnSimilarity("MIC5504-3.3", "MIC5504-1.2YM5-TR");
    expect(s).toBeGreaterThan(0.4);
    expect(s).toBeLessThan(0.9);
  });

  it("不同厂家不同系列分数低", () => {
    expect(mpnSimilarity("LM2776DBVR", "STM32F103C8T6")).toBeLessThan(0.3);
  });

  it("空值返回 0,不报错", () => {
    expect(mpnSimilarity(null, "ABC")).toBe(0);
    expect(mpnSimilarity("ABC", undefined)).toBe(0);
  });
});

describe("footprintAgreement", () => {
  it("一致 / 前缀 / 不一致", () => {
    expect(footprintAgreement("SOT-23-6", "SOT-23-6")).toBe(1);
    expect(footprintAgreement("QFN-32", "QFN-32-1EP")).toBe(0.6);
    expect(footprintAgreement("SOT-23-5", "TQFP-48")).toBe(0);
  });

  it("**缺一边就是未知**,返回 null 而不是判为不吻合", () => {
    expect(footprintAgreement(null, "SOT-23-6")).toBeNull();
    expect(footprintAgreement("SOT-23-6", "")).toBeNull();
  });
});

describe("scoreSimilarity:封装只加减分,不做硬过滤", () => {
  it("封装一致时加分并写明依据", () => {
    const r = scoreSimilarity(
      { value: "LM2776", packageCode: "SOT-23-6" },
      { mpn: "LM2776DBVR", footprint: "SOT-23-6" },
    );
    expect(r.footprintScore).toBe(1);
    expect(r.reasons).toContain("封装完全一致");
    expect(r.score).toBeGreaterThan(r.mpnScore);
  });

  it("封装不一致显著降分,但不直接淘汰(工程 BOM 封装写法千奇百怪)", () => {
    const r = scoreSimilarity(
      { value: "LM2776", packageCode: "TQFP-48" },
      { mpn: "LM2776DBVR", footprint: "SOT-23-6" },
    );
    expect(r.footprintScore).toBe(0);
    expect(r.score).toBeLessThan(r.mpnScore);
    expect(r.reasons).toContain("封装不一致");
  });

  it("封装信息缺失时如实说明未参与打分", () => {
    const r = scoreSimilarity({ value: "LM2776" }, { mpn: "LM2776DBVR" });
    expect(r.footprintScore).toBeNull();
    expect(r.score).toBe(r.mpnScore);
    expect(r.reasons).toContain("封装信息不足,未参与打分");
  });

  it("packageCode 缺失时回退用原始封装串(ezPLM 封装名与 KiCad 同源)", () => {
    const r = scoreSimilarity(
      { value: "LM2776", footprint: "SOT-23-6" },
      { mpn: "LM2776DBVR", footprint: "SOT-23-6" },
    );
    expect(r.footprintScore).toBe(1);
  });
});

describe("rankBySimilarity:取最像的几个,低分一律不给", () => {
  // 取自 ezPLM 真实返回
  const TARGETS = [
    { mpn: "MIC5504-1.2YM5-T5", footprint: "SOT-23-5" },
    { mpn: "MIC5504-1.2YM5-TR", footprint: "SOT-23-5" },
    { mpn: "MIC5504-1.2YMT-T5", footprint: "X2-DFN-4_1x1mm_P0.65mm" },
    { mpn: "MIC5504-1.8YM5-T5", footprint: "SOT-23-5" },
    { mpn: "STM32F103C8T6", footprint: "TQFP-48_7x7mm_P0.5mm" },
  ];

  it("同系列排在前面,无关型号被剔除", () => {
    const ranked = rankBySimilarity(
      { value: "MIC5504-3.3", packageCode: "SOT-23-5" },
      TARGETS,
      { limit: 3 },
    );
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(3);
    expect(ranked.every((r) => r.target.mpn.startsWith("MIC5504"))).toBe(true);
    expect(ranked.map((r) => r.target.mpn)).not.toContain("STM32F103C8T6");
  });

  it("封装一致的同系列型号排在封装不一致的前面", () => {
    const ranked = rankBySimilarity({ value: "MIC5504-1.2", packageCode: "SOT-23-5" }, TARGETS);
    const sot = ranked.findIndex((r) => r.target.footprint === "SOT-23-5");
    const dfn = ranked.findIndex((r) => r.target.footprint?.startsWith("X2-DFN"));
    expect(sot).toBeGreaterThanOrEqual(0);
    if (dfn >= 0) expect(sot).toBeLessThan(dfn);
  });

  it("没有够格的候选时返回空数组 —— 宁可说没有,也不塞一堆无关型号", () => {
    expect(rankBySimilarity({ value: "完全不相干的东西XYZ" }, TARGETS)).toEqual([]);
    expect(rankBySimilarity({ value: null }, TARGETS)).toEqual([]);
  });

  it("同分时按 MPN 排序,结果稳定(便于回归比对)", () => {
    const a = rankBySimilarity({ value: "MIC5504" }, TARGETS);
    const b = rankBySimilarity({ value: "MIC5504" }, [...TARGETS].reverse());
    expect(a.map((r) => r.target.mpn)).toEqual(b.map((r) => r.target.mpn));
  });
});
