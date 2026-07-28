import { describe, expect, it } from "vitest";
import { mpnEquals, normalizeManufacturer, normalizeMpn } from "@/lib/providers/common/mpn";

describe("MPN 标准化(SPEC §17 单测项)", () => {
  it("大小写、空格、分隔符差异归一为同一键", () => {
    expect(normalizeMpn("rc0603fr-07 10kl")).toBe("RC0603FR0710KL");
    expect(normalizeMpn("RC0603FR0710KL")).toBe("RC0603FR0710KL");
    expect(normalizeMpn("GRM188R71H104KA93D")).toBe("GRM188R71H104KA93D");
  });

  it("空值安全:null/undefined/空串一律返回空字符串", () => {
    expect(normalizeMpn(null)).toBe("");
    expect(normalizeMpn(undefined)).toBe("");
    expect(normalizeMpn("   ")).toBe("");
  });

  it("mpnEquals:空对空不算相等(避免无 MPN 辅料互相误命中)", () => {
    expect(mpnEquals("STM32F103C8T6", "stm32f103c8t6")).toBe(true);
    expect(mpnEquals("MAX232CPE", "MAX3232EIDR")).toBe(false);
    expect(mpnEquals(null, null)).toBe(false);
    expect(mpnEquals("", "")).toBe(false);
  });

  it("不同 MPN 不因去分隔符而误判相等", () => {
    // 去掉分隔符后仍必须不同
    expect(mpnEquals("RC0603-10K", "RC060310K1")).toBe(false);
  });

  it("制造商标准化:去公司后缀与多余空白", () => {
    expect(normalizeManufacturer("Murata Electronics")).toBe("MURATA ELECTRONICS");
    expect(normalizeManufacturer("Texas Instruments Inc.")).toBe("TEXAS INSTRUMENTS");
    expect(normalizeManufacturer("YAGEO Corporation")).toBe("YAGEO");
    expect(normalizeManufacturer(null)).toBe("");
  });
});
