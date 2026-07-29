import { describe, expect, it } from "vitest";
import {
  cleanPackageName,
  packageAgreement,
  packageFamily,
  pinCountFromPackage,
} from "@/lib/domain/part-spec";

describe("cleanPackageName", () => {
  it("去掉 KiCad 库前缀,归一大小写", () => {
    expect(cleanPackageName("Package_TO_SOT_SMD:SOT-23-5")).toBe("SOT-23-5");
    expect(cleanPackageName(" sot-23-6 ")).toBe("SOT-23-6");
    expect(cleanPackageName(null)).toBeNull();
  });
});

describe("packageFamily", () => {
  it("取封装族", () => {
    expect(packageFamily("SOT-23-5")).toBe("SOT");
    expect(packageFamily("Package_DFN_QFN:QFN-32-1EP_5x5mm")).toBe("QFN");
    expect(packageFamily("TQFP-48_7x7mm_P0.5mm")).toBe("TQFP");
    expect(packageFamily("MSOP-10_3x3mm")).toBe("MSOP");
  });

  it("片式尺寸归为 CHIP", () => {
    expect(packageFamily("0402")).toBe("CHIP");
    expect(packageFamily("Capacitor_SMD:C_0603_1608Metric")).toBe("CHIP");
  });
});

describe("pinCountFromPackage:认不出就 null,绝不猜", () => {
  it("族名后跟数字的直接取", () => {
    expect(pinCountFromPackage("QFN-32-1EP_5x5mm_P0.5mm")).toBe(32);
    expect(pinCountFromPackage("TQFP-48_7x7mm_P0.5mm")).toBe(48);
    expect(pinCountFromPackage("MSOP-10_3x3mm")).toBe(10);
    expect(pinCountFromPackage("SOIC-8")).toBe(8);
    expect(pinCountFromPackage("LQFP-64")).toBe(64);
  });

  it("**SOT-23 是 3 脚不是 23 脚;SOD-123 是 2 脚不是 123 脚**", () => {
    expect(pinCountFromPackage("SOT-23")).toBe(3);
    expect(pinCountFromPackage("SOD-123")).toBe(2);
    expect(pinCountFromPackage("SOT-223")).toBe(4);
    expect(pinCountFromPackage("SOT-89")).toBe(3);
  });

  it("SOT-23-5 / SOT-23-6:固定编号后面才是真实管脚数", () => {
    expect(pinCountFromPackage("SOT-23-5")).toBe(5);
    expect(pinCountFromPackage("SOT-23-6")).toBe(6);
    expect(pinCountFromPackage("Package_TO_SOT_SMD:SOT-23-6")).toBe(6);
  });

  it("片式元件都是两端", () => {
    expect(pinCountFromPackage("0402")).toBe(2);
    expect(pinCountFromPackage("Capacitor_SMD:C_0603_1608Metric")).toBe(2);
  });

  it("认不出返回 null", () => {
    expect(pinCountFromPackage("Oscillator_SMD_Abracon_ASE-4Pin")).toBeNull();
    expect(pinCountFromPackage("Top Jumper Socket")).toBeNull();
    expect(pinCountFromPackage(null)).toBeNull();
  });
});

describe("packageAgreement:管脚数不同是硬否决", () => {
  it("完全一致", () => {
    const r = packageAgreement("SOT-23-6", "Package_TO_SOT_SMD:SOT-23-6");
    expect(r.exact).toBe(true);
    expect(r.compatible).toBe(true);
  });

  it("**SOT-23-5 与 SOT-23-6 判为不可换** —— 只差一个字符,但焊上去会短路", () => {
    const r = packageAgreement("SOT-23-5", "SOT-23-6");
    expect(r.pinCount).toBe(false);
    expect(r.compatible).toBe(false);
    expect(r.reasons.join()).toContain("管脚数不同");
  });

  it("族相同且管脚相同 → 可换", () => {
    const r = packageAgreement("QFN-32-1EP_5x5mm", "QFN-32_4x4mm");
    expect(r.family).toBe(true);
    expect(r.pinCount).toBe(true);
    expect(r.compatible).toBe(true);
  });

  it("族不同但管脚相同 → 结论未定(需工程判断能否改板)", () => {
    const r = packageAgreement("SOIC-8", "MSOP-8");
    expect(r.family).toBe(false);
    expect(r.pinCount).toBe(true);
    expect(r.compatible).toBeNull();
  });

  it("信息不足时返回 null,不当成「不一致」", () => {
    const r = packageAgreement(null, "SOT-23-5");
    expect(r.compatible).toBeNull();
    expect(r.reasons).toContain("封装信息不足");
  });
});
