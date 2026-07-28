import { describe, expect, it } from "vitest";
import {
  normalizeText,
  parseCompliance,
  parseLeadTimeDays,
  parseLifecycle,
  parseQuantity,
} from "@/lib/providers/common/parse";

/**
 * 否定式表述回归套件(PR4 评审第二项:缺陷类排查)。
 *
 * 根因:语义判定用裸 includes 会让否定式命中肯定式子串。
 * 本文件对每个语义解析函数,逐条钉死"否定式不得误判为肯定式"。
 * 新增外部字段解析时,必须在此补对应的否定式用例。
 */

describe("生命周期:否定式不得误判为在产", () => {
  it.each([
    ["Inactive", "OBSOLETE"], // 含子串 "active",绝不能判为 ACTIVE
    ["INACTIVE", "OBSOLETE"],
    ["Obsolete", "OBSOLETE"],
    ["Not In Production", "UNKNOWN"], // 含子串 "production"
    ["No Longer Available", "UNKNOWN"],
    ["Not Active", "UNKNOWN"],
    ["Out of Production", "UNKNOWN"],
    ["Not Recommended for New Designs", "NRND"], // 含子串 "recommended"
    ["Not For New Designs", "NRND"],
    ["NRND", "NRND"],
    ["Last Time Buy", "NRND"],
    ["End of Life", "EOL"],
    ["Discontinued at Digi-Key", "EOL"],
    ["Active", "ACTIVE"],
    ["In Production", "ACTIVE"],
    ["New Product", "ACTIVE"],
    ["", "UNKNOWN"],
    ["某种未知状态", "UNKNOWN"],
  ])("parseLifecycle(%j) → %s", (input, expected) => {
    expect(parseLifecycle(input)).toBe(expected);
  });

  it("任何含否定词而无法精确归类的状态,一律不得落到 ACTIVE", () => {
    for (const s of [
      "Not In Production",
      "Not Active",
      "No Longer Manufactured",
      "Out of Production",
      "Not Available for New Designs",
    ]) {
      expect(parseLifecycle(s)).not.toBe("ACTIVE");
    }
  });
});

describe("合规:否定式不得误判为合规", () => {
  it.each([
    ["REACH Unaffected", true], // 含子串 "affected"
    ["Unaffected", true],
    ["REACH Affected", false],
    ["Not Compliant", false], // 含子串 "compliant"
    ["Non-Compliant", false],
    ["Non-RoHS", false],
    ["RoHS Non-Compliant", false],
    ["ROHS3 Compliant", true],
    ["RoHS Compliant By Exemption", true],
    ["RoHS Exempt", true],
    ["Unknown", null],
    ["Undetermined", null],
    ["Not Applicable", null],
    ["", null],
  ])("parseCompliance(%j) → %s", (input, expected) => {
    expect(parseCompliance(input)).toBe(expected);
  });

  it("任何含 NOT/NON 的合规表述都不得判为合规", () => {
    for (const s of ["Not Compliant", "Non-Compliant", "Non-RoHS", "Not RoHS Compliant"]) {
      expect(parseCompliance(s)).toBe(false);
    }
  });
});

describe("库存:欠货/询价表述不得当作现货", () => {
  it.each([
    ["500 In Stock", 500],
    ["500,000 In Stock", 500000],
    ["0 In Stock", 0],
    ["None In Stock", 0],
    ["Out of Stock", 0],
    ["Backorder 5000 expected", null], // 数字是预计到货,不是现货
    ["On Order 1200", null],
    ["Call for Availability", null],
    ["Contact us", null],
    ["", null],
  ])("parseQuantity(%j) → %s", (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });

  it("千分位不得被截断为首段数字", () => {
    expect(parseQuantity("500,000 In Stock")).toBe(500000);
    expect(parseQuantity("1,234,567")).toBe(1234567);
  });
});

describe("交期:区间取上界,不得低估", () => {
  it.each([
    ["1-2 Weeks", 14],
    ["6-8 Weeks", 56],
    ["10 Weeks", 70],
    ["14 Days", 14],
    ["3~5 Days", 5],
    ["2 to 4 Weeks", 28],
    ["6周", 42],
    ["1 月", 30],
    ["Call for lead time", null],
    ["", null],
  ])("parseLeadTimeDays(%j) → %s", (input, expected) => {
    expect(parseLeadTimeDays(input)).toBe(expected);
  });
});

describe("normalizeText(语义判定的统一前置)", () => {
  it("大写化并把分隔符压成单空格", () => {
    expect(normalizeText("Non-RoHS")).toBe("NON ROHS");
    expect(normalizeText("Discontinued at Digi-Key")).toBe("DISCONTINUED AT DIGI KEY");
    expect(normalizeText("  Not   Compliant  ")).toBe("NOT COMPLIANT");
  });

  it("保留中文与数字(ROHS3 / 6周 不被拆坏)", () => {
    expect(normalizeText("ROHS3 Compliant")).toBe("ROHS3 COMPLIANT");
    expect(normalizeText("6周")).toBe("6周");
  });
});
