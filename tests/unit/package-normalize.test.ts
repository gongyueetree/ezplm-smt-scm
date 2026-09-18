/**
 * REF-2a:封装归一共享规则。
 */
import { describe, expect, it } from "vitest";
import { footprintKey, KICAD_CLASS_PREFIXES, KICAD_CLASS_SEGMENT } from "@/modules/bom/domain/package-normalize";
import { parseKicadFootprint } from "@/lib/domain/kicad-value";
import { cleanPackageName } from "@/lib/domain/part-spec";
import { normalizeFootprint } from "@/lib/domain/bom-validate";
import { normalizeMpnKey } from "@/modules/parts/domain/part-identity";

describe("footprintKey:判等用的键", () => {
  it("去分隔符、大写:SOIC-16 ≡ SOIC16,0603 ≡ 0603", () => {
    expect(footprintKey("SOIC-16")).toBe(footprintKey("soic16"));
    expect(footprintKey("0603")).toBe("0603");
  });

  it("与 MPN 键同一套字符规则(REF-1 的教训:两处规则不同就会静默失配)", () => {
    for (const s of ["SOT-23-5", "QFN-32_5x5mm", "0603贴片", ""]) {
      expect(footprintKey(s), s).toBe(normalizeMpnKey(s));
    }
  });

  it("兼容层 normalizeFootprint ≡ footprintKey", () => {
    for (const s of ["SOIC-16", "0402", "LQFP-48"]) expect(normalizeFootprint(s)).toBe(footprintKey(s));
  });
});

describe("KiCad 类别字母:两处合一", () => {
  it("并集包含 CP(极性电容)与 FL(滤波器)", () => {
    expect(KICAD_CLASS_PREFIXES).toContain("CP");
    expect(KICAD_CLASS_PREFIXES).toContain("FL");
    expect(KICAD_CLASS_SEGMENT.test("cp")).toBe(true); // 大小写不敏感
    expect(KICAD_CLASS_SEGMENT.test("CPX")).toBe(false); // 必须整段匹配
  });

  it("**同一个封装串在两处得到一致的去类别结果**(此前 kicad-value 缺 CP/FL)", () => {
    // 旧 kicad-value:packageCode = "CP_Elec_6.3x5.4";part-spec 早已剥掉 CP
    expect(parseKicadFootprint("Capacitor_SMD:CP_Elec_6.3x5.4")?.packageCode).toBe("Elec_6.3x5.4");
    expect(cleanPackageName("Capacitor_SMD:CP_Elec_6.3x5.4")).toBe("ELEC_6.3X5.4");
    expect(parseKicadFootprint("Filter:FL_0805")?.packageCode).toBe("0805");
  });

  it("既有写法不受影响", () => {
    expect(parseKicadFootprint("Capacitor_SMD:C_0603_1608Metric")?.packageCode).toBe("0603");
    expect(parseKicadFootprint("Package_TO_SOT_SMD:SOT-23-5")?.packageCode).toBe("SOT-23-5");
    expect(parseKicadFootprint("Resistor_SMD:R_0402_1005Metric")?.packageCode).toBe("0402");
  });
});
