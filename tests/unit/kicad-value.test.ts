import { describe, expect, it } from "vitest";
import {
  inferMpnFromValue,
  isComponentParameterValue,
  looksLikeMpn,
  parseKicadFootprint,
  refDesClass,
} from "@/lib/domain/kicad-value";

describe("refDesClass:按位号前缀判器件类别", () => {
  it("无源 / 有源 / 连接器 / 机电", () => {
    expect(refDesClass("R1")).toBe("passive");
    expect(refDesClass("C14")).toBe("passive");
    expect(refDesClass("L3")).toBe("passive");
    expect(refDesClass("U2")).toBe("active");
    expect(refDesClass("D1")).toBe("active");
    expect(refDesClass("Q5")).toBe("active");
    expect(refDesClass("J4")).toBe("connector");
    expect(refDesClass("SW1")).toBe("electromechanical");
    expect(refDesClass("Y1")).toBe("electromechanical");
  });

  it("取位号列表的第一个(同行必然同类)", () => {
    expect(refDesClass("C4, C1, C5, C8,")).toBe("passive");
    expect(refDesClass("R6, R7, R8")).toBe("passive");
  });

  it("认不出就是 unknown,不硬套", () => {
    expect(refDesClass("ZZ9")).toBe("unknown");
    expect(refDesClass(null)).toBe("unknown");
    expect(refDesClass("")).toBe("unknown");
  });
});

describe("isComponentParameterValue:参数不是型号", () => {
  it("真实样本里的阻容感/晶振值全部判为参数", () => {
    for (const v of ["0.1uF", "10uF", "15pF", "1uF", "2.4p", "10k", "2k", "1k", "510", "7.8k", "270", "4.3k", "16MHz"]) {
      expect(isComponentParameterValue(v), v).toBe(true);
    }
  });

  it("欧标写法与带耐压/容差的写法", () => {
    expect(isComponentParameterValue("4R7")).toBe(true);
    expect(isComponentParameterValue("0R")).toBe(true);
    expect(isComponentParameterValue("100nF/50V")).toBe(true);
    expect(isComponentParameterValue("±1%")).toBe(true);
  });

  it("型号不会被误判成参数", () => {
    for (const v of ["CH340E", "LPC824M201JHI33", "ADA4851-1YRJZ-RL7", "MIC5504-3.3YM5-TR"]) {
      expect(isComponentParameterValue(v), v).toBe(false);
    }
  });
});

describe("looksLikeMpn:型号形态", () => {
  it("真实 IC 型号判为真", () => {
    for (const v of ["CH340E", "LM2776DBVR", "MachXO2-1200-QFN32", "LPC824M201JHI33", "MIC5504-3.3"]) {
      expect(looksLikeMpn(v), v).toBe(true);
    }
  });

  it("**含下划线的一律否**——那是 KiCad 符号名不是型号", () => {
    for (const v of ["USB_B_Micro", "Header_1x5", "Header_1x2", "MMCX_V"]) {
      expect(looksLikeMpn(v), v).toBe(false);
    }
  });

  it("纯字母标签(网络名/丝印)判为否", () => {
    for (const v of ["STA", "PWR", "RST", "ISP"]) {
      expect(looksLikeMpn(v), v).toBe(false);
    }
  });

  it("参数、过短、带空格的描述都判为否", () => {
    expect(looksLikeMpn("10k")).toBe(false);
    expect(looksLikeMpn("A1")).toBe(false);
    expect(looksLikeMpn("RES 10K 0603")).toBe(false);
  });
});

describe("inferMpnFromValue:结合位号与形态推断", () => {
  it("IC 的 Value 就是 MPN,置信度最高", () => {
    const r = inferMpnFromValue({ value: "LPC824M201JHI33", refDes: "U2" })!;
    expect(r.mpn).toBe("LPC824M201JHI33");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.reason).toContain("有源器件");
  });

  it("无源器件的参数值**不会**被当成 MPN", () => {
    expect(inferMpnFromValue({ value: "0.1uF", refDes: "C1, C3" })).toBeNull();
    expect(inferMpnFromValue({ value: "2k", refDes: "R1, R2" })).toBeNull();
    expect(inferMpnFromValue({ value: "16MHz", refDes: "X1" })).toBeNull();
  });

  it("连接器/开关的符号名与标签不会被当成 MPN", () => {
    expect(inferMpnFromValue({ value: "USB_B_Micro", refDes: "J1" })).toBeNull();
    expect(inferMpnFromValue({ value: "Header_1x5", refDes: "J2" })).toBeNull();
    expect(inferMpnFromValue({ value: "RST", refDes: "SW1" })).toBeNull();
    expect(inferMpnFromValue({ value: "PWR", refDes: "D2" })).toBeNull();
  });

  it("电阻位号上写了真实型号时也能认出来,但置信度更低", () => {
    const r = inferMpnFromValue({ value: "RC0603FR-0710KL", refDes: "R1" })!;
    expect(r.mpn).toBe("RC0603FR-0710KL");
    expect(r.confidence).toBeLessThan(0.8);
  });

  it("空值返回 null,不硬凑", () => {
    expect(inferMpnFromValue({ value: null, refDes: "U1" })).toBeNull();
    expect(inferMpnFromValue({ value: "   ", refDes: "U1" })).toBeNull();
  });
});

describe("parseKicadFootprint:封装归一", () => {
  it("贴片阻容:丢掉类别前缀与公制尺寸,留下英制代码", () => {
    expect(parseKicadFootprint("Capacitor_SMD:C_0603_1608Metric")).toMatchObject({
      library: "Capacitor_SMD",
      packageCode: "0603",
    });
    expect(parseKicadFootprint("Resistor_SMD:R_0402_1005Metric")?.packageCode).toBe("0402");
    expect(parseKicadFootprint("LED_SMD:LED_0603_1608Metric")?.packageCode).toBe("0603");
  });

  it("SOT / MSOP / QFN", () => {
    expect(parseKicadFootprint("Package_TO_SOT_SMD:SOT-23-5")?.packageCode).toBe("SOT-23-5");
    expect(parseKicadFootprint("Package_SO:MSOP-10_3x3mm_P0.5mm")?.packageCode).toBe("MSOP-10");
    // -1EP 是散热焊盘标注,不属于封装代码
    expect(
      parseKicadFootprint("Package_DFN_QFN:QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm")?.packageCode,
    ).toBe("QFN-32");
  });

  it("没有库前缀时也能解析", () => {
    expect(parseKicadFootprint("SOT-23-6")).toMatchObject({ library: null, packageCode: "SOT-23-6" });
  });

  it("空值返回 null", () => {
    expect(parseKicadFootprint(null)).toBeNull();
    expect(parseKicadFootprint("  ")).toBeNull();
  });
});
