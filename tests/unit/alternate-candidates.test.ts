import { describe, expect, it } from "vitest";
import {
  familyPrefix,
  filterCandidates,
  normalizeForFamily,
} from "@/lib/domain/alternate-candidates";

describe("familyPrefix:同系列候选检索关键字", () => {
  it("过短型号不推导(避免捞回半个库)", () => {
    expect(familyPrefix("C123")).toBeNull();
    expect(familyPrefix("MAX23")).toBeNull();
    expect(familyPrefix("")).toBeNull();
  });

  it("带 - 的型号取第一段", () => {
    expect(familyPrefix("RC0603FR-0710KL")).toBe("RC0603FR");
    expect(familyPrefix("CL10B104KB8NNNC-X")).toBe("CL10B104KB8NNNC");
  });

  it("- 出现得太早时不按它切分,回退到去尾规则", () => {
    // "AB-CDEFGHIJ":第一段只有 2 字符,切了等于没切
    expect(familyPrefix("AB-CDEFGHIJ")).toBe("AB-CDEFG");
  });

  it("无分隔符时去掉末尾 3 个字符(封装/容差/编带后缀)", () => {
    expect(familyPrefix("STM32F103C8T6")).toBe("STM32F103C");
    expect(familyPrefix("GRM188R71H104KA93D")).toBe("GRM188R71H104KA");
  });

  it("保底保留 6 个字符,不会切成噪音级前缀", () => {
    expect(familyPrefix("ABCDEF")).toBe("ABCDEF");
    expect(familyPrefix("ABCDEFG")).toBe("ABCDEF");
  });

  it("规范化:大小写与空白/下划线不影响结果", () => {
    expect(normalizeForFamily(" stm32f103 c8t6 ")).toBe("STM32F103C8T6");
    expect(familyPrefix(" stm32f103c8t6 ")).toBe(familyPrefix("STM32F103C8T6"));
  });
});

describe("filterCandidates:剔除自身与重复", () => {
  const rows = [
    { mpn: "STM32F103C8T6", manufacturer: "ST" },
    { mpn: "stm32f103c8t6", manufacturer: "ST" },
    { mpn: "STM32F103CBT6", manufacturer: "ST" },
    { mpn: "STM32F103RBT6", manufacturer: "ST" },
  ];

  it("自身不作为自己的候选,大小写不同也算同一颗", () => {
    const out = filterCandidates("STM32F103C8T6", rows);
    expect(out.map((r) => r.mpn)).toEqual(["STM32F103CBT6", "STM32F103RBT6"]);
  });

  it("limit 生效且保持原顺序(不打分排序,避免暗示结论)", () => {
    const out = filterCandidates("NO-SUCH", rows, 2);
    expect(out.map((r) => r.mpn)).toEqual(["STM32F103C8T6", "STM32F103CBT6"]);
  });
});
