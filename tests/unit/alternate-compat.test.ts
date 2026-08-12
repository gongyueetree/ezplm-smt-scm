import { describe, expect, it } from "vitest";
import {
  canWriteToPartMaster,
  compatibilityScore,
  matchesPreset,
  needsReview,
  normalizeEvidence,
  rankByCompatibility,
  summarizeCompat,
  type CompatibilityTriple,
} from "@/lib/domain/alternate-compat";

/**
 * E2 / 客户 Q10:「**实现功能一致是最重要的**,功能不能不同。
 * 需要增加「功能一致、但封装有细微差别」的筛选条件」。
 */

const t = (
  functional: CompatibilityTriple["functional"],
  packageCompat: CompatibilityTriple["packageCompat"],
  pin: CompatibilityTriple["pin"],
): CompatibilityTriple => ({ functional, packageCompat, pin });

describe("排序:功能一致绝对优先", () => {
  it("**功能一致但封装不同,排在封装一致但功能只是部分一致的前面**", () => {
    const funcSamePkgDiff = compatibilityScore(t("EXACT", "DIFFERENT", "NOT_COMPATIBLE"));
    const pkgSameFuncPartial = compatibilityScore(t("PARTIAL", "EXACT", "PIN_TO_PIN"));
    expect(funcSamePkgDiff).toBeGreaterThan(pkgSameFuncPartial);
  });

  it("功能维度的差别压过封装与引脚**全部**差别之和", () => {
    const best封装引脚 = compatibilityScore(t("EQUIVALENT", "EXACT", "PIN_TO_PIN"));
    const worst封装引脚 = compatibilityScore(t("EXACT", "DIFFERENT", "NOT_COMPATIBLE"));
    // EXACT 即使封装引脚全差,也高于 EQUIVALENT 全好
    expect(worst封装引脚).toBeGreaterThan(best封装引脚);
  });

  it("功能相同时,封装更接近的排前面", () => {
    const a = compatibilityScore(t("EXACT", "EXACT", "PIN_TO_PIN"));
    const b = compatibilityScore(t("EXACT", "MINOR_VARIATION", "PIN_TO_PIN"));
    const c = compatibilityScore(t("EXACT", "DIFFERENT", "PIN_TO_PIN"));
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it("排序稳定:同分保持输入顺序", () => {
    const same = t("EXACT", "EXACT", "PIN_TO_PIN");
    const out = rankByCompatibility([
      { item: "a", compat: same },
      { item: "b", compat: same },
      { item: "c", compat: same },
    ]);
    expect(out.map((x) => x.item)).toEqual(["a", "b", "c"]);
  });
});

describe("客户点名的四种筛选", () => {
  it("功能一致 + 封装一致", () => {
    expect(matchesPreset(t("EXACT", "EXACT", "PIN_TO_PIN"), "FUNC_SAME_PKG_SAME")).toBe(true);
    expect(matchesPreset(t("EXACT", "MINOR_VARIATION", "PIN_TO_PIN"), "FUNC_SAME_PKG_SAME")).toBe(false);
    // 功能不一致就不算,哪怕封装完全一样
    expect(matchesPreset(t("PARTIAL", "EXACT", "PIN_TO_PIN"), "FUNC_SAME_PKG_SAME")).toBe(false);
  });

  it("**功能一致 + 封装细微差别** —— 客户这次点名新增的一档", () => {
    expect(matchesPreset(t("EXACT", "MINOR_VARIATION", "PIN_TO_PIN"), "FUNC_SAME_PKG_MINOR")).toBe(true);
    expect(matchesPreset(t("EQUIVALENT", "MINOR_VARIATION", "REQUIRES_REVIEW"), "FUNC_SAME_PKG_MINOR")).toBe(true);
    expect(matchesPreset(t("EXACT", "EXACT", "PIN_TO_PIN"), "FUNC_SAME_PKG_MINOR")).toBe(false);
  });

  it("功能一致 + 非 Pin-to-Pin(需工程确认)", () => {
    expect(matchesPreset(t("EXACT", "EXACT", "REQUIRES_REVIEW"), "FUNC_SAME_NOT_PIN")).toBe(true);
    expect(matchesPreset(t("EXACT", "EXACT", "NOT_COMPATIBLE"), "FUNC_SAME_NOT_PIN")).toBe(true);
    expect(matchesPreset(t("EXACT", "EXACT", "PIN_TO_PIN"), "FUNC_SAME_NOT_PIN")).toBe(false);
  });

  it("只看完全 Pin-to-Pin:封装也必须完全一致", () => {
    expect(matchesPreset(t("EXACT", "EXACT", "PIN_TO_PIN"), "PIN_TO_PIN_ONLY")).toBe(true);
    expect(matchesPreset(t("EXACT", "MINOR_VARIATION", "PIN_TO_PIN"), "PIN_TO_PIN_ONLY")).toBe(false);
  });

  it("**UNKNOWN 一律不算命中** —— 不知道不等于符合", () => {
    expect(matchesPreset(t("UNKNOWN", "EXACT", "PIN_TO_PIN"), "FUNC_SAME_PKG_SAME")).toBe(false);
    expect(matchesPreset(t("EXACT", "UNKNOWN", "PIN_TO_PIN"), "FUNC_SAME_PKG_SAME")).toBe(false);
    expect(matchesPreset(t("EXACT", "EXACT", "UNKNOWN"), "PIN_TO_PIN_ONLY")).toBe(false);
  });

  it("筛选后仍按功能优先排序", () => {
    const out = rankByCompatibility(
      [
        { item: "eq", compat: t("EQUIVALENT", "MINOR_VARIATION", "PIN_TO_PIN") },
        { item: "exact", compat: t("EXACT", "MINOR_VARIATION", "REQUIRES_REVIEW") },
      ],
      { preset: "FUNC_SAME_PKG_MINOR" },
    );
    expect(out.map((x) => x.item)).toEqual(["exact", "eq"]);
  });
});

describe("结论措辞", () => {
  it("功能未确认一致时明确写「不建议直接替换」", () => {
    expect(summarizeCompat(t("PARTIAL", "EXACT", "PIN_TO_PIN"))).toContain("不建议直接替换");
    expect(summarizeCompat(t("UNKNOWN", "EXACT", "PIN_TO_PIN"))).toContain("不建议直接替换");
  });

  it("只有三项全绿才说「可直接换料」", () => {
    expect(summarizeCompat(t("EXACT", "EXACT", "PIN_TO_PIN"))).toContain("可直接换料");
    expect(summarizeCompat(t("EXACT", "MINOR_VARIATION", "PIN_TO_PIN"))).not.toContain("可直接换料");
  });

  it("引脚不兼容时点明需改板", () => {
    expect(summarizeCompat(t("EXACT", "EXACT", "NOT_COMPATIBLE"))).toContain("需改板");
  });

  it("**任何一项不是最优都要工程确认** —— 不知道不等于没问题", () => {
    expect(needsReview(t("EXACT", "EXACT", "PIN_TO_PIN"))).toBe(false);
    expect(needsReview(t("EXACT", "EXACT", "UNKNOWN"))).toBe(true);
    expect(needsReview(t("EXACT", "UNKNOWN", "PIN_TO_PIN"))).toBe(true);
    expect(needsReview(t("UNKNOWN", "EXACT", "PIN_TO_PIN"))).toBe(true);
  });
});

describe("参数证据:网络数据不得污染主数据", () => {
  const web = {
    origin: "WEB" as const,
    sourceUrl: "https://example.com/x",
    fetchedAt: "2026-08-11T00:00:00.000Z",
    value: "10k",
    verified: true, // 调用方即使传 true 也不算数
  };

  it("**网络来源强制 verified=false**,调用方说了不算", () => {
    expect(normalizeEvidence(web).verified).toBe(false);
  });

  it("**网络来源永远不能写回 Part 主数据**", () => {
    expect(canWriteToPartMaster(normalizeEvidence(web))).toBe(false);
    // 即使没归一化也不行
    expect(canWriteToPartMaster(web)).toBe(false);
  });

  it("人工核实过的非网络来源才可以写主数据", () => {
    expect(
      canWriteToPartMaster({ origin: "EZPLM", sourceUrl: null, fetchedAt: null, value: "10k", verified: true }),
    ).toBe(true);
    // 没核实过的照样不行
    expect(
      canWriteToPartMaster({ origin: "EZPLM", sourceUrl: null, fetchedAt: null, value: "10k", verified: false }),
    ).toBe(false);
  });
});
