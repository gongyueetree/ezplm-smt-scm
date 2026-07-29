import { describe, expect, it } from "vitest";
import { compareParam, parseParamValue, matchParamName } from "@/lib/domain/param-compare";

describe("parseParamValue:识别数值/区间/列表/文本", () => {
  it("带单位的数值,量纲前缀折算进数值", () => {
    expect(parseParamValue("72 MHz")).toMatchObject({ kind: "number", number: 72e6, unit: "HZ" });
    expect(parseParamValue("64 KB")).toMatchObject({ kind: "number", number: 64e3, unit: "B" });
    expect(parseParamValue("37")).toMatchObject({ kind: "number", number: 37 });
  });

  it("区间:to / ~ / - 都认", () => {
    expect(parseParamValue("2.0 to 3.6 V")).toMatchObject({ kind: "range", range: [2, 3.6] });
    expect(parseParamValue("-40~85°C")).toMatchObject({ kind: "range", range: [-40, 85] });
  });

  it("列表", () => {
    expect(parseParamValue("UART×3, SPI×2, CAN")).toMatchObject({
      kind: "list",
      list: ["UART×3", "SPI×2", "CAN"],
    });
  });

  it("文本/枚举", () => {
    expect(parseParamValue("ARM Cortex-M3")).toMatchObject({ kind: "text", text: "ARM CORTEX-M3" });
    expect(parseParamValue("")).toBeNull();
    expect(parseParamValue(null)).toBeNull();
  });
});

describe("compareParam:未知不等于不满足", () => {
  it("原型号没给该参数 → 未知,分数为 null(不能按 0 计入)", () => {
    const r = compareParam(null, "72 MHz");
    expect(r.verdict).toBe("未知");
    expect(r.score).toBeNull();
  });

  it("候选没提供该参数 → 缺失,分数为 null", () => {
    const r = compareParam("72 MHz", null);
    expect(r.verdict).toBe("缺失");
    expect(r.score).toBeNull();
  });
});

describe("compareParam:数值", () => {
  it("完全一致", () => {
    expect(compareParam("64 KB", "64 KB")).toMatchObject({ score: 100, verdict: "一致" });
  });

  it("越大越好的参数,候选更高 → 更优(不是差异)", () => {
    const r = compareParam("72 MHz", "108 MHz", { higherIsBetter: true });
    expect(r.verdict).toBe("更优");
    expect(r.score).toBe(100);
  });

  it("越大越好的参数,候选更低 → 明确指出欠配风险", () => {
    const r = compareParam("72 MHz", "48 MHz", { higherIsBetter: true });
    expect(r.verdict).toBe("有差异");
    expect(r.detail).toContain("欠配");
    expect(r.score!).toBeLessThan(100);
  });

  it("不区分方向时,偏差越大分越低", () => {
    const near = compareParam("100", "90");
    const far = compareParam("100", "10");
    expect(near.score!).toBeGreaterThan(far.score!);
  });
});

describe("compareParam:区间(工作电压/温度)", () => {
  it("候选完全覆盖要求 → 一致", () => {
    expect(compareParam("2.0 to 3.6 V", "1.8 to 5.5 V")).toMatchObject({
      score: 100,
      verdict: "一致",
    });
  });

  it("**候选区间更窄 → 部分覆盖**,并给出覆盖比例", () => {
    // 真实场景:要求 2.0–3.6V,候选只有 2.6–3.6V,低端覆盖不住
    const r = compareParam("2.0 to 3.6 V", "2.6 to 3.6 V");
    expect(r.verdict).toBe("部分覆盖");
    expect(r.score).toBe(63); // (3.6-2.6)/(3.6-2.0)
    expect(r.detail).toContain("只覆盖");
  });

  it("完全不重叠 → 0 分", () => {
    expect(compareParam("2.0 to 3.6 V", "5.0 to 12 V")).toMatchObject({ score: 0, verdict: "有差异" });
  });
});

describe("compareParam:接口列表", () => {
  it("所需接口全部具备 → 一致", () => {
    expect(compareParam("UART×3, SPI×2", "UART×3, SPI×2, CAN")).toMatchObject({
      score: 100,
      verdict: "一致",
    });
  });

  it("**路数不够也算缺** —— UART×3 的位置换 UART×2 是不行的", () => {
    const r = compareParam("UART×3, SPI×2", "UART×2, SPI×2");
    expect(r.verdict).toBe("部分覆盖");
    expect(r.detail).toContain("UART");
    expect(r.detail).toContain("需3实2");
  });

  it("完全缺失 → 有差异", () => {
    expect(compareParam("CAN, USB", "I2C, SPI").verdict).toBe("有差异");
  });
});

describe("compareParam:文本/枚举", () => {
  it("一致 / 不一致", () => {
    expect(compareParam("ARM Cortex-M3", "arm cortex-m3").score).toBe(100);
    expect(compareParam("ARM Cortex-M3", "ARM Cortex-M0+").score).toBe(0);
    expect(compareParam("LQFP-48", "LQFP-48").verdict).toBe("一致");
  });
});

describe("matchParamName:ezPLM 属性命名不统一,按主名对齐", () => {
  it("主名相同即匹配(后面的说明性后缀忽略)", () => {
    expect(matchParamName("SRAM容量 - 数据存储器容量 (KB)", "SRAM容量")).toBe(true);
    expect(matchParamName("时钟频率 - 最大工作频率 (MHz)", "时钟频率")).toBe(true);
    expect(matchParamName("工作温度", "工作温度 (°C)")).toBe(true);
  });

  it("**不同概念不得互相匹配** —— 工作温度不能对上工作电压", () => {
    expect(matchParamName("工作温度", "工作电压")).toBe(false);
    expect(matchParamName("SRAM容量", "Flash容量")).toBe(false);
  });

  it("过短的主名不参与包含匹配,避免一个字匹配一切", () => {
    expect(matchParamName("电", "电压")).toBe(false);
  });

  it("空值不匹配", () => {
    expect(matchParamName("", "工作温度")).toBe(false);
  });
});
