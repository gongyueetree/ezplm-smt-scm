/**
 * N-5.E 比价总表汇总。
 *
 * 最高/最低价直接决定跟谁下单,所以这里守三件事:
 * 不用浮点比大小、异币种不混比、没报价不给 0。
 */
import { describe, expect, it } from "vitest";
import { buildCompareSummary, summarizeExtremes, type CompareOfferInput } from "@/lib/domain/compare-summary";

function offer(p: Partial<CompareOfferInput>): CompareOfferInput {
  return {
    supplierName: "供应商A",
    source: "OFFLINE",
    mpn: "STM32F103",
    quotedMpn: "STM32F103",
    manufacturer: "ST",
    currency: "CNY",
    unitPrice: "10",
    moq: null,
    spq: null,
    leadTimeDays: null,
    note: null,
    ...p,
  };
}

describe("最高/最低价", () => {
  it("选出正确的供应商,而不只是数字", () => {
    const [row] = buildCompareSummary([
      offer({ supplierName: "甲", unitPrice: "12.5" }),
      offer({ supplierName: "乙", unitPrice: "9.8" }),
      offer({ supplierName: "丙", unitPrice: "15.0" }),
    ]);
    expect(row.byCurrency[0].lowest).toEqual({ supplierName: "乙", unitPrice: "9.8" });
    expect(row.byCurrency[0].highest).toEqual({ supplierName: "丙", unitPrice: "15.0" });
  });

  it("**用 Decimal 比大小** —— 浮点会在这种数上选错", () => {
    const [row] = buildCompareSummary([
      offer({ supplierName: "甲", unitPrice: "0.30000000000000004" }),
      offer({ supplierName: "乙", unitPrice: "0.3" }),
    ]);
    expect(row.byCurrency[0].lowest!.supplierName).toBe("乙");
  });

  it("高精度小数不被截断", () => {
    const [row] = buildCompareSummary([
      offer({ supplierName: "甲", unitPrice: "1.000001" }),
      offer({ supplierName: "乙", unitPrice: "1.000002" }),
    ]);
    expect(row.byCurrency[0].lowest!.supplierName).toBe("甲");
  });
});

describe("**异币种绝不混比**", () => {
  it("按币种分组各自算极值", () => {
    const [row] = buildCompareSummary([
      offer({ supplierName: "甲", currency: "CNY", unitPrice: "70" }),
      offer({ supplierName: "乙", currency: "USD", unitPrice: "10" }),
    ]);
    expect(row.mixedCurrency).toBe(true);
    expect(row.byCurrency.map((c) => c.currency)).toEqual(["CNY", "USD"]);
    // 10 USD 不能因为数字小就被判成"最低价"
    expect(row.byCurrency.find((c) => c.currency === "CNY")!.lowest!.supplierName).toBe("甲");
    expect(row.byCurrency.find((c) => c.currency === "USD")!.lowest!.supplierName).toBe("乙");
  });

  it("摘要必须点明未做汇率换算,需人工比对", () => {
    const [row] = buildCompareSummary([
      offer({ currency: "CNY", unitPrice: "70" }),
      offer({ supplierName: "乙", currency: "USD", unitPrice: "10" }),
    ]);
    expect(summarizeExtremes(row)).toContain("未做汇率换算");
  });

  it("币种大小写归一,usd 与 USD 是同一种", () => {
    const [row] = buildCompareSummary([
      offer({ supplierName: "甲", currency: "usd", unitPrice: "10" }),
      offer({ supplierName: "乙", currency: "USD", unitPrice: "9" }),
    ]);
    expect(row.mixedCurrency).toBe(false);
    expect(row.byCurrency[0].lowest!.supplierName).toBe("乙");
  });
});

describe("没报价不给 0", () => {
  it("全部无价 → noQuote,且不产生任何极值", () => {
    const [row] = buildCompareSummary([offer({ unitPrice: null }), offer({ unitPrice: "" })]);
    expect(row.noQuote).toBe(true);
    expect(row.byCurrency).toEqual([]);
    expect(summarizeExtremes(row)).toContain("无有效报价");
  });

  it("部分无价时只用有价的算,无价的不当成 0", () => {
    const [row] = buildCompareSummary([
      offer({ supplierName: "甲", unitPrice: null }),
      offer({ supplierName: "乙", unitPrice: "5" }),
    ]);
    expect(row.byCurrency[0].lowest!.supplierName).toBe("乙");
    expect(row.byCurrency[0].offerCount).toBe(1);
  });

  it("非法价格串按无价处理,不抛错也不当 0", () => {
    const [row] = buildCompareSummary([
      offer({ supplierName: "甲", unitPrice: "面议" }),
      offer({ supplierName: "乙", unitPrice: "5" }),
    ]);
    expect(row.byCurrency[0].offerCount).toBe(1);
    expect(row.byCurrency[0].lowest!.supplierName).toBe("乙");
  });
});

describe("仅一个报价", () => {
  it("最高=最低,但必须标注不构成比价结论", () => {
    const [row] = buildCompareSummary([offer({ supplierName: "甲", unitPrice: "12.5" })]);
    expect(row.singleQuoteCurrencies).toEqual(["CNY"]);
    expect(summarizeExtremes(row)).toContain("仅 1 个报价");
  });
});

describe("替代料与备注", () => {
  it("报的型号与询价型号不同即为替代料", () => {
    const [row] = buildCompareSummary([
      offer({ supplierName: "甲", quotedMpn: "STM32F103" }),
      offer({ supplierName: "乙", quotedMpn: "GD32F103", manufacturer: "GD" }),
    ]);
    expect(row.alternates).toEqual([
      { supplierName: "乙", quotedMpn: "GD32F103", manufacturer: "GD" },
    ]);
  });

  it("空备注不进总表,有备注的带上供应商", () => {
    const [row] = buildCompareSummary([
      offer({ supplierName: "甲", note: "  " }),
      offer({ supplierName: "乙", note: "需签框架协议" }),
    ]);
    expect(row.notes).toEqual([{ supplierName: "乙", note: "需签框架协议" }]);
  });
});

describe("按 MPN 分组", () => {
  it("不同 MPN 各成一行,不串价", () => {
    const rows = buildCompareSummary([
      offer({ mpn: "A", supplierName: "甲", unitPrice: "1" }),
      offer({ mpn: "B", supplierName: "乙", unitPrice: "100" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.mpn === "A")!.byCurrency[0].highest!.unitPrice).toBe("1");
  });
});
