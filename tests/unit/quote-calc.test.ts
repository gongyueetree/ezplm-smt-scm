import { describe, expect, it } from "vitest";
import {
  BUILTIN_LABOR_TEMPLATES,
  QUOTE_COST_CATEGORIES,
  calculateFinalUnitPrice,
  calculateLabor,
  calculateLineExtended,
  calculatePpv,
  deriveMarkupPct,
  summarizeQuote,
  type QuoteLineForCalc,
} from "@/lib/domain/quote-calc";

describe("Markup 与最终物料报价(SPEC §12)", () => {
  it("最终单价 = 采购成本 × (1 + Markup)", () => {
    expect(calculateFinalUnitPrice("10", "0.085").toFixed()).toBe("10.85");
    expect(calculateFinalUnitPrice("0.0123", "0.2").toFixed()).toBe("0.01476");
  });

  it("Markup 为 0 或缺省时等于采购成本", () => {
    expect(calculateFinalUnitPrice("10", "0").toFixed()).toBe("10");
    expect(calculateFinalUnitPrice("10", null).toFixed()).toBe("10");
  });

  it("无浮点误差(0.1 × 3 类问题)", () => {
    expect(calculateFinalUnitPrice("0.1", "0.1").toFixed()).toBe("0.11");
    expect(calculateLineExtended("0.1", 3).toFixed()).toBe("0.3");
  });

  it("由售价反推 Markup;采购成本为 0 时无定义", () => {
    expect(deriveMarkupPct("10", "10.85")?.toFixed()).toBe("0.085");
    expect(deriveMarkupPct("0", "5")).toBeNull();
  });
});

describe("PPV(口径待业务确认,但计算确定)", () => {
  it("PPV = (采购成本 − 基准成本) × 数量,正值为超支", () => {
    expect(calculatePpv("12", "10", 100)?.toFixed()).toBe("200");
    expect(calculatePpv("9", "10", 100)?.toFixed()).toBe("-100");
  });

  it("缺基准时返回 null,而不是按 0 计算成「零差异」", () => {
    expect(calculatePpv("12", null, 100)).toBeNull();
    expect(calculatePpv("12", "", 100)).toBeNull();
  });
});

describe("人工费率模板(多模板 + 手工调整)", () => {
  const template = BUILTIN_LABOR_TEMPLATES[0];

  it("按模板计算 SMT/DIP/测试/基础人工", () => {
    const r = calculateLabor(template, {
      boards: 100,
      smtPoints: 500,
      dipPoints: 20,
      testHours: 3,
    });
    expect(r.smt.toFixed()).toBe("400"); // 500 × 0.008 × 100
    expect(r.dip.toFixed()).toBe("100"); // 20 × 0.05 × 100
    expect(r.test.toFixed()).toBe("180"); // 3 × 60
    expect(r.labor.toFixed()).toBe("120"); // 100 × 1.2
    expect(r.overridden).toEqual([]);
  });

  it("不同模板给出不同结果(小批量费率更高)", () => {
    const std = calculateLabor(BUILTIN_LABOR_TEMPLATES[0], { boards: 10, smtPoints: 100 });
    const small = calculateLabor(BUILTIN_LABOR_TEMPLATES[1], { boards: 10, smtPoints: 100 });
    expect(small.smt.greaterThan(std.smt)).toBe(true);
  });

  it("手工调整覆盖模板值并留痕(审批可见)", () => {
    const r = calculateLabor(template, {
      boards: 100,
      smtPoints: 500,
      overrides: { smt: "350" },
    });
    expect(r.smt.toFixed()).toBe("350");
    expect(r.overridden).toEqual(["smt"]);
  });
});

describe("整单汇总(八类成本)", () => {
  const lines: QuoteLineForCalc[] = [
    { lineNo: 1, category: "MATERIAL", qty: 1000, purchaseCost: "0.08", markupPct: "0.1" },
    { lineNo: 2, category: "MATERIAL", qty: 2000, purchaseCost: "0.12", markupPct: "0.1" },
    { lineNo: 3, category: "SMT", qty: 1, purchaseCost: "400" },
    { lineNo: 4, category: "TEST", qty: 1, purchaseCost: "180" },
  ];

  it("按分类汇总并给出总价", () => {
    const s = summarizeQuote(lines, { currency: "CNY" });
    // 材料:1000×0.08×1.1 = 88;2000×0.12×1.1 = 264 → 352
    expect(s.byCategory.MATERIAL).toBe("352.00");
    expect(s.byCategory.SMT).toBe("400.00");
    expect(s.byCategory.TEST).toBe("180.00");
    expect(s.subtotalBeforeOverhead).toBe("932.00");
    expect(s.grandTotal).toBe("932.00");
  });

  it("管理费按费率计提并计入总价", () => {
    const s = summarizeQuote(lines, { currency: "CNY", overheadPct: "0.05" });
    expect(s.overhead).toBe("46.60"); // 932 × 5%
    expect(s.grandTotal).toBe("978.60");
  });

  it("管理费分类行与费率计提可并存", () => {
    const s = summarizeQuote([...lines, { lineNo: 5, category: "OVERHEAD", qty: 1, purchaseCost: "50" }], {
      currency: "CNY",
      overheadPct: "0.05",
    });
    expect(s.overhead).toBe("96.60"); // 50 + 932×5%
  });

  it("人工指定客户报价覆盖 Markup 计算值并标记", () => {
    const s = summarizeQuote(
      [{ lineNo: 1, category: "MATERIAL", qty: 100, purchaseCost: "10", markupPct: "0.1", customerPrice: "12" }],
      { currency: "CNY" },
    );
    expect(s.lines[0].finalUnitPrice).toBe("11.00");
    expect(s.lines[0].effectiveUnitPrice).toBe("12.00");
    expect(s.lines[0].priceOverridden).toBe(true);
    expect(s.byCategory.MATERIAL).toBe("1200.00");
  });

  it("PPV 合计只统计给出基准的行", () => {
    const s = summarizeQuote(
      [
        { lineNo: 1, category: "MATERIAL", qty: 100, purchaseCost: "12", baselineCost: "10" },
        { lineNo: 2, category: "MATERIAL", qty: 100, purchaseCost: "12" },
      ],
      { currency: "CNY" },
    );
    expect(s.lines[0].ppv).toBe("200.00");
    expect(s.lines[1].ppv).toBeNull();
    expect(s.ppvTotal).toBe("200.00");
  });

  it("八个分类都出现在汇总中(即使为 0)", () => {
    const s = summarizeQuote([], { currency: "CNY" });
    for (const c of QUOTE_COST_CATEGORIES) expect(s.byCategory[c]).toBe("0.00");
    expect(s.grandTotal).toBe("0.00");
  });

  it("中间不做逐行舍入:三行 0.005 不会各自舍成 0.01", () => {
    const s = summarizeQuote(
      [1, 2, 3].map((n) => ({ lineNo: n, category: "MATERIAL" as const, qty: 1, purchaseCost: "0.005" })),
      { currency: "CNY" },
    );
    // 0.005 × 3 = 0.015 → 舍入到 0.02(而非逐行舍入后的 0.03)
    expect(s.byCategory.MATERIAL).toBe("0.02");
  });
});
