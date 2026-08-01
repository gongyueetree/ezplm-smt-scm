import { describe, expect, it } from "vitest";
import { categoryCode, generateCode, previewCodes, resolveCode, type PartCodeRuleSpec } from "@/lib/domain/part-code-rule";

function rule(over: Partial<PartCodeRuleSpec> = {}): PartCodeRuleSpec {
  return {
    prefix: "EE",
    includeCategory: true,
    separator: "-",
    sequenceWidth: 4,
    currentSequence: 41,
    allowManual: true,
    ...over,
  };
}

describe("生成料号", () => {
  it("前缀 + 分类码 + 补零流水号", () => {
    expect(generateCode(rule(), "IC").code).toBe("EE-IC-0042");
  });

  it("**流水号补零** —— 保证字典序与数字序一致", () => {
    expect(generateCode(rule({ currentSequence: 8 }), "IC").code).toBe("EE-IC-0009");
    const codes = [9, 10, 99].map((n) => generateCode(rule({ currentSequence: n - 1 }), "IC").code);
    expect([...codes].sort()).toEqual(codes);
  });

  it("可关掉分类段", () => {
    expect(generateCode(rule({ includeCategory: false }), "IC").code).toBe("EE-0042");
  });

  it("**分类映射不到时用 GEN,不猜**", () => {
    expect(categoryCode("没见过的分类")).toBe("GEN");
    expect(categoryCode(null)).toBe("GEN");
  });
});

describe("resolveCode", () => {
  it("允许人工时采用人工填的号", () => {
    const r = resolveCode(rule(), { manualCode: "MY-PART-1", categoryL1: "IC" });
    expect(r.ok && r.source).toBe("MANUAL");
  });

  it("**不允许人工时必须拒绝,而不是悄悄替换** —— 替换会让人以为自己填的生效了", () => {
    const r = resolveCode(rule({ allowManual: false }), { manualCode: "MY-PART-1" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("不允许人工指定料号");
  });

  it("非法字符被拒并说明允许什么", () => {
    const r = resolveCode(rule(), { manualCode: "有中文的料号" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("只接受字母、数字");
  });

  it("没填就自动生成", () => {
    const r = resolveCode(rule(), { categoryL1: "阻容感" });
    expect(r.ok && r.source).toBe("GENERATED");
    expect(r.ok && r.code).toBe("EE-RC-0042");
  });
});

describe("预览", () => {
  it("连续预览若干个号", () => {
    expect(previewCodes(rule(), "IC", 3)).toEqual(["EE-IC-0042", "EE-IC-0043", "EE-IC-0044"]);
  });

  it("预览数量有上下限,不会被传入极值搞爆", () => {
    expect(previewCodes(rule(), "IC", 0)).toHaveLength(1);
    expect(previewCodes(rule(), "IC", 999)).toHaveLength(20);
  });
});
