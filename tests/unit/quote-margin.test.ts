import { describe, expect, it } from "vitest";
import { computeGrossMargin } from "@/lib/domain/quote-margin";

/**
 * F1:毛利纯函数。核心守则:**缺成本的行不许被当成零成本** ——
 * 快照里 null→"0" 的陷阱就是本模块绕开快照、单独取原始行的原因。
 */
const q = (code: string, grandTotal: string, lines: { qty: string | null; purchaseCost: string | null }[], currency = "CNY") => ({
  quoteCode: code, currency, grandTotal, lines,
});

describe("毛利", () => {
  it("完整成本:毛利 = (收入−成本)/收入,Decimal 精度", () => {
    const r = computeGrossMargin([q("Q1", "100.00", [{ qty: "10", purchaseCost: "6" }])]);
    expect(r.byCurrency).toEqual([
      { currency: "CNY", revenue: "100.00", cost: "60.00", marginPct: "0.4000", quoteCount: 1 },
    ]);
    expect(r.excluded).toEqual([]);
  });

  it("**任何一行缺成本 → 整张报价排除并给原因**,不当零成本", () => {
    const r = computeGrossMargin([
      q("Q1", "100.00", [{ qty: "10", purchaseCost: "6" }, { qty: "1", purchaseCost: null }]),
    ]);
    expect(r.computableQuotes).toBe(0);
    expect(r.byCurrency).toEqual([]);
    expect(r.excluded[0].reason).toContain("1 行缺采购成本");
  });

  it("成本明确为 0 是合法的(免费料),与缺失不同", () => {
    const r = computeGrossMargin([q("Q1", "50.00", [{ qty: "5", purchaseCost: "0" }])]);
    expect(r.byCurrency[0].marginPct).toBe("1.0000");
  });

  it("异币种各算各的,不合并", () => {
    const r = computeGrossMargin([
      q("Q1", "100.00", [{ qty: "1", purchaseCost: "40" }], "CNY"),
      q("Q2", "10.00", [{ qty: "1", purchaseCost: "7" }], "USD"),
    ]);
    expect(r.byCurrency.map((c) => c.currency)).toEqual(["CNY", "USD"]);
  });

  it("没有可算报价 → 空结果,不出现 0%", () => {
    expect(computeGrossMargin([]).byCurrency).toEqual([]);
  });

  it("浮点会错的数必须算对(0.1×3 成本)", () => {
    const r = computeGrossMargin([q("Q1", "1.00", [{ qty: "3", purchaseCost: "0.1" }])]);
    expect(r.byCurrency[0].cost).toBe("0.30");
    expect(r.byCurrency[0].marginPct).toBe("0.7000");
  });
});
