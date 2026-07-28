import { describe, expect, it } from "vitest";
import {
  detectSupplierQuoteMapping,
  isSupplierQuoteMappingUsable,
  missingSupplierQuoteFields,
  toSupplierQuoteLines,
} from "@/lib/domain/supplier-quote-parse";

const OPTS = { fallbackCurrency: "CNY" };

describe("供应商报价列映射(B5)", () => {
  it("识别中文表头的全部字段", () => {
    const rows = [
      ["制造商料号", "制造商", "单价", "币种", "MOQ", "SPQ", "交期"],
      ["RC0603FR-0710KL", "Yageo", "0.08", "CNY", "1000", "5000", "14 天"],
    ];
    const m = detectSupplierQuoteMapping(rows);
    expect(m.fields).toMatchObject({
      mpn: 0,
      manufacturer: 1,
      unitPrice: 2,
      currency: 3,
      moq: 4,
      spq: 5,
      leadTimeDays: 6,
    });
    expect(isSupplierQuoteMappingUsable(m)).toBe(true);
  });

  it("识别英文表头", () => {
    const rows = [
      ["MPN", "Manufacturer", "Unit Price", "Currency", "MOQ", "SPQ", "Lead Time"],
      ["GRM188R71H104KA93D", "Murata", "0.12", "USD", "2000", "2000", "6 weeks"],
    ];
    const m = detectSupplierQuoteMapping(rows);
    expect(isSupplierQuoteMappingUsable(m)).toBe(true);
    expect(m.fields.leadTimeDays).toBe(6);
  });

  it("缺 MPN 或单价即不可用,并指出缺哪个", () => {
    const m = detectSupplierQuoteMapping([["制造商", "MOQ"], ["Yageo", "1000"]]);
    expect(isSupplierQuoteMappingUsable(m)).toBe(false);
    expect(missingSupplierQuoteFields(m)).toEqual(["mpn", "unitPrice"]);
  });

  it("「制造商料号」不会被「制造商」的子串匹配抢走(PR5 同款陷阱)", () => {
    const rows = [["制造商", "制造商料号", "单价"], ["Yageo", "RC0603", "0.08"]];
    const m = detectSupplierQuoteMapping(rows);
    expect(m.fields.manufacturer).toBe(0);
    expect(m.fields.mpn).toBe(1);
  });

  it("跳过前置标题行定位真正表头", () => {
    const rows = [
      ["XX 电子报价单"],
      ["报价日期:2026-07-28"],
      [""],
      ["MPN", "单价", "MOQ"],
      ["ABC", "1.5", "500"],
    ];
    const m = detectSupplierQuoteMapping(rows);
    expect(m.headerRowIndex).toBe(3);
  });
});

describe("供应商报价行解析", () => {
  const rows = [
    ["制造商料号", "制造商", "单价", "币种", "MOQ", "SPQ", "交期"],
    ["RC0603FR-0710KL", "Yageo", "¥0.08", "CNY", "1,000", "5000", "14 天"],
    ["GRM188R71H104KA93D", "Murata", "$0.12", "USD", "2000", "2000", "6 weeks"],
  ];
  const mapping = detectSupplierQuoteMapping(rows);

  it("MOQ / SPQ / Lead Time 全部解析出来(B5 的核心)", () => {
    const { lines } = toSupplierQuoteLines(rows, mapping, OPTS);
    expect(lines[0]).toMatchObject({
      mpn: "RC0603FR-0710KL",
      unitPrice: "0.08",
      currency: "CNY",
      moq: 1000,
      spq: 5000,
      leadTimeDays: 14,
    });
    // 6 weeks → 42 天
    expect(lines[1]).toMatchObject({ currency: "USD", leadTimeDays: 42, moq: 2000 });
  });

  it("货币符号与千分位被正确剥离", () => {
    const { lines } = toSupplierQuoteLines(
      [["MPN", "单价"], ["A", "¥1,234.56"]],
      detectSupplierQuoteMapping([["MPN", "单价"], ["A", "¥1,234.56"]]),
      OPTS,
    );
    expect(lines[0].unitPrice).toBe("1234.56");
  });

  it("单价无法解析的行被跳过并记原因,绝不按 0 落库", () => {
    const bad = [["MPN", "单价"], ["A", "面议"], ["B", "1.5"]];
    const { lines, skipped } = toSupplierQuoteLines(bad, detectSupplierQuoteMapping(bad), OPTS);
    expect(lines).toHaveLength(1);
    expect(lines[0].mpn).toBe("B");
    expect(skipped[0]).toMatchObject({ sourceRow: 2 });
    expect(skipped[0].reason).toContain("单价无法解析");
  });

  it("单价为 0 或负数被拒", () => {
    const bad = [["MPN", "单价"], ["A", "0"], ["B", "-1"]];
    const { lines, skipped } = toSupplierQuoteLines(bad, detectSupplierQuoteMapping(bad), OPTS);
    expect(lines).toHaveLength(0);
    expect(skipped).toHaveLength(2);
  });

  it("缺 MPN 但有其它内容的行被记为跳过", () => {
    const bad = [["MPN", "单价"], ["", "1.5"]];
    const { skipped } = toSupplierQuoteLines(bad, detectSupplierQuoteMapping(bad), OPTS);
    expect(skipped[0].reason).toBe("缺少 MPN");
  });

  it("MOQ/SPQ/LT 缺列时为 null(不猜默认值)", () => {
    const minimal = [["MPN", "单价"], ["A", "1.5"]];
    const { lines } = toSupplierQuoteLines(minimal, detectSupplierQuoteMapping(minimal), OPTS);
    expect(lines[0]).toMatchObject({ moq: null, spq: null, leadTimeDays: null });
  });

  it("无币种列时回落到显式指定的币种,而不是硬编码 CNY", () => {
    const minimal = [["MPN", "单价"], ["A", "1.5"]];
    const { lines } = toSupplierQuoteLines(minimal, detectSupplierQuoteMapping(minimal), {
      fallbackCurrency: "USD",
    });
    expect(lines[0].currency).toBe("USD");
  });

  it("全空行被忽略且不记为跳过", () => {
    const withBlank = [["MPN", "单价"], ["", ""], ["A", "1.5"]];
    const { lines, skipped } = toSupplierQuoteLines(
      withBlank,
      detectSupplierQuoteMapping(withBlank),
      OPTS,
    );
    expect(lines).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });
});
