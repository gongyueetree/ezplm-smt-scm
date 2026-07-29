import { describe, expect, it } from "vitest";
import {
  backfilledFields,
  hasValue,
  mergeFields,
  missingFieldsAfterMerge,
} from "@/lib/domain/field-merge";

const BOM = {
  name: "BOM",
  values: { manufacturer: "MuRata", description: null, footprint: null },
};
const EZPLM = {
  name: "EZPLM",
  values: { manufacturer: "Murata Manufacturing", footprint: "1210", lifecycle: "UNKNOWN" },
};
const DIGIKEY = {
  name: "DIGIKEY",
  values: {
    manufacturer: "Murata Electronics",
    description: "CAP CER 4.7UF 100V X7S 1210",
    footprint: "1210",
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    packaging: "Tape & Reel",
  },
};

describe("hasValue:什么算「有值」", () => {
  it("空串/空白/null/undefined 都算没有", () => {
    expect(hasValue(null)).toBe(false);
    expect(hasValue(undefined)).toBe(false);
    expect(hasValue("")).toBe(false);
    expect(hasValue("   ")).toBe(false);
  });

  it("**UNKNOWN 算没有** —— 它是「不知道」,不能把后面的源挡住", () => {
    expect(hasValue("UNKNOWN")).toBe(false);
    expect(hasValue("unknown")).toBe(false);
  });

  it("布尔 false 算有值(不合规也是一种结论)", () => {
    expect(hasValue(false)).toBe(true);
    expect(hasValue(true)).toBe(true);
  });
});

describe("mergeFields:只补空,不覆盖", () => {
  const merged = mergeFields([BOM, EZPLM, DIGIKEY]);

  it("**已有值绝不被外部源覆盖** —— 客户写的制造商就是客户的意思", () => {
    expect(merged.manufacturer).toEqual({ value: "MuRata", source: "BOM" });
  });

  it("缺的字段按源顺序回填,并记住来源", () => {
    expect(merged.footprint).toEqual({ value: "1210", source: "EZPLM" });
    expect(merged.description).toEqual({
      value: "CAP CER 4.7UF 100V X7S 1210",
      source: "DIGIKEY",
    });
  });

  it("ezPLM 的 UNKNOWN 不挡住 DigiKey 的真实生命周期", () => {
    expect(merged.lifecycle).toEqual({ value: "ACTIVE", source: "DIGIKEY" });
  });

  it("布尔字段正常回填", () => {
    expect(merged.rohs).toEqual({ value: true, source: "DIGIKEY" });
  });

  it("所有源都没有就是 null,**不猜** ", () => {
    expect(merged.msl).toEqual({ value: null, source: null });
    expect(missingFieldsAfterMerge(merged)).toContain("msl");
  });

  it("空源列表不报错", () => {
    const empty = mergeFields([]);
    expect(empty.manufacturer).toEqual({ value: null, source: null });
  });
});

describe("backfilledFields:哪些是外部补的(审计与 UI 提示)", () => {
  it("只列出非主源提供的字段", () => {
    const merged = mergeFields([BOM, EZPLM, DIGIKEY]);
    const back = backfilledFields(merged, "BOM");
    const fields = back.map((b) => b.field);
    expect(fields).not.toContain("manufacturer"); // 主源自带
    expect(fields).toContain("footprint");
    expect(fields).toContain("description");
    expect(back.find((b) => b.field === "description")?.source).toBe("DIGIKEY");
  });

  it("完全没有回填时返回空", () => {
    const merged = mergeFields([
      { name: "BOM", values: { manufacturer: "X", description: "Y" } },
    ]);
    expect(backfilledFields(merged, "BOM")).toEqual([]);
  });
});
