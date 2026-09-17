/**
 * R0-4:报价行「字段级 patch」与「整行 upsert」必须是两种语义。
 *
 * 缺陷现场:Agent 审批只传 {lineNo, category, materialCategory, markupPct},
 * 而 upsertQuoteLine 的 update 分支用 `input.x ?? null` 装配整行 data 再 updateMany,
 * 于是批准一条 AI 分类建议会把该行的 qty / purchaseCost / customerPrice /
 * quotedMfg / quotedMpn / altMfg / altMpn / note **全部置 null** ——
 * 包括 markup 本来要乘的那个 purchaseCost。
 *
 * 这里锁住的核心区别:**未提供 ≠ 置空**。
 */
import { describe, expect, it } from "vitest";
import { buildQuoteLinePatch } from "@/lib/domain/quote-line-patch";

const WIPEABLE = [
  "qty",
  "purchaseCost",
  "customerPrice",
  "quotedMfg",
  "quotedMpn",
  "altMfg",
  "altMpn",
  "note",
] as const;

describe("R0-4 buildQuoteLinePatch", () => {
  it("只给分类与 Markup → patch 里就只有这两个键,其余列一个都不出现", () => {
    const patch = buildQuoteLinePatch({
      materialCategory: "阻容感",
      markupPct: "0.18",
    });
    expect(Object.keys(patch).sort()).toEqual(["markupPct", "materialCategory"]);
    for (const k of WIPEABLE) {
      expect(patch).not.toHaveProperty(k);
    }
  });

  it("显式传 null = 人要清空该字段,必须保留在 patch 里(与「未提供」区分开)", () => {
    const patch = buildQuoteLinePatch({ note: null });
    expect(patch).toHaveProperty("note", null);
    expect(Object.keys(patch)).toEqual(["note"]);
  });

  it("undefined 一律省略 —— 这正是缺陷的反面", () => {
    const patch = buildQuoteLinePatch({
      materialCategory: "IC",
      qty: undefined,
      purchaseCost: undefined,
    });
    expect(patch).toEqual({ materialCategory: "IC" });
  });

  it("空 patch 是合法的(调用方据此跳过写库,而不是写一行空值)", () => {
    expect(buildQuoteLinePatch({})).toEqual({});
  });

  it("Agent 审批用到的那组字段照常通过", () => {
    const patch = buildQuoteLinePatch({
      category: "MATERIAL",
      materialCategory: "阻容感",
      markupPct: "0.18",
    });
    expect(patch).toEqual({
      category: "MATERIAL",
      materialCategory: "阻容感",
      markupPct: "0.18",
    });
  });
});
