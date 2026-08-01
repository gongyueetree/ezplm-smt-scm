import { describe, expect, it } from "vitest";
import {
  buildInternalPn,
  checkDuplicates,
  hasBlockingDuplicate,
  mergeExtracted,
  mpnKeySegment,
  normalizeInternalPn,
  validateDraft,
  validateForActivation,
} from "@/lib/domain/part-create";

describe("草稿 vs 正式创建的校验强度不同", () => {
  it("草稿只要有一项可识别信息就能存", () => {
    expect(validateDraft({ mpn: "STM32F103C8T6" })).toEqual([]);
    expect(validateDraft({ description: "先记一笔" })).toEqual([]);
  });

  it("完全空白的草稿没有意义,拒绝", () => {
    expect(validateDraft({}).length).toBe(1);
  });

  it("正式创建:五项必填一个都不能少", () => {
    const issues = validateForActivation({ mpn: "STM32F103C8T6" });
    expect(issues.map((i) => i.field).sort()).toEqual(
      ["categoryL1", "description", "internalPn", "manufacturer"].sort(),
    );
  });

  it("正式创建:全填即通过", () => {
    expect(
      validateForActivation({
        internalPn: "EE-IC-STM32F103-C8",
        mpn: "STM32F103C8T6",
        categoryL1: "IC",
        manufacturer: "STMicroelectronics",
        description: "ARM Cortex-M3 32-bit MCU",
      }),
    ).toEqual([]);
  });

  it("空白字符不算填了", () => {
    expect(validateForActivation({ internalPn: "   ", mpn: "X", categoryL1: "IC", manufacturer: "M", description: "D" })
      .map((i) => i.field)).toEqual(["internalPn"]);
  });
});

describe("内部料号编码规则", () => {
  it("按模板生成(截图规则 EE-[类别]-[型号])", () => {
    expect(
      buildInternalPn("{prefix}-{cat}-{key}", { prefix: "EE", categoryCode: "IC", key: "STM32F103C8" }),
    ).toBe("EE-IC-STM32F103C8");
  });

  it("**缺少必要输入时返回 null,不硬凑一个料号**", () => {
    expect(buildInternalPn("{prefix}-{cat}-{key}", { categoryCode: "IC" })).toBeNull();
    expect(buildInternalPn("{prefix}-{cat}-{key}", { key: "X" })).toBeNull();
    expect(buildInternalPn("{prefix}-{seq}", {})).toBeNull();
  });

  it("流水号补零", () => {
    expect(buildInternalPn("{prefix}-{seq}", { seq: 7 })).toBe("EE-0007");
  });

  it("归一:大写、去空格、压缩连字符", () => {
    expect(normalizeInternalPn(" ee--ic -0001 ")).toBe("EE-IC-0001");
  });

  it("MPN 取型号关键段:去掉包装/卷带后缀", () => {
    expect(mpnKeySegment("STM32F103C8T6-TR")).toBe("STM32F103C8T6");
    expect(mpnKeySegment("CL10B104KB8NNNC")).toBe("CL10B104KB8NNNC");
  });
});

describe("疑似重复:不允许静默创建", () => {
  const base = { internalPn: "EE-IC-0001", mpn: "STM32F103C8T6" };

  it("**内部料号同租户重复 → 阻断**", () => {
    const c = checkDuplicates({
      ...base,
      localByInternalPn: { id: "p1", internalPn: "EE-IC-0001", mpn: "X", manufacturer: "M" },
    });
    expect(c[0].kind).toBe("SAME_INTERNAL_PN");
    expect(hasBlockingDuplicate(c)).toBe(true);
  });

  it("MPN 相同只是**疑似**,不阻断,但必须给出候选让人处置", () => {
    const c = checkDuplicates({
      ...base,
      localByMpn: [{ id: "p2", internalPn: "EE-IC-0009", mpn: "STM32F103C8T6", manufacturer: "ST" }],
    });
    expect(c[0].kind).toBe("SAME_MPN");
    expect(hasBlockingDuplicate(c)).toBe(false);
    expect(c[0].reason).toContain("EE-IC-0009");
  });

  it("ezPLM 已有该 MPN → 提示可直接引用,不必自建", () => {
    const c = checkDuplicates({
      ...base,
      ezplmByMpn: [{ id: "e1", internalPn: null, mpn: "STM32F103C8T6", manufacturer: "ST" }],
    });
    expect(c[0].from).toBe("EZPLM");
    expect(c[0].reason).toContain("可直接引用");
  });

  it("命中客户料号映射 → 提示可能是别名", () => {
    const c = checkDuplicates({
      ...base,
      customerPnAlias: [{ id: "p3", internalPn: "EE-IC-0777", mpn: "STM32F103C8T6", manufacturer: "ST" }],
    });
    expect(c[0].kind).toBe("CUSTOMER_PN_ALIAS");
  });

  it("没有任何命中时返回空,不编造疑似项", () => {
    expect(checkDuplicates(base)).toEqual([]);
  });
});

describe("AI 提取合并:只填空,绝不覆盖人工值", () => {
  it("**人工已填的字段必须原样保留**", () => {
    const r = mergeExtracted(
      { footprint: "LQFP-48", tempRange: "" },
      {
        footprint: { value: "LQFP48", confidence: 0.9 },
        tempRange: { value: "-40 ~ +85 ℃", confidence: 0.8 },
      },
    );
    expect(r.merged.footprint).toBe("LQFP-48");
    expect(r.keptManual).toEqual(["footprint"]);
    expect(r.merged.tempRange).toBe("-40 ~ +85 ℃");
    expect(r.filledByAi).toEqual(["tempRange"]);
  });

  it("只有空白的字段才会被填", () => {
    const r = mergeExtracted({ a: "   " }, { a: { value: "AI", confidence: 1 } });
    expect(r.merged.a).toBe("AI");
  });

  it("没有提取结果时原样返回", () => {
    const r = mergeExtracted({ a: "x" }, {});
    expect(r.merged.a).toBe("x");
    expect(r.filledByAi).toEqual([]);
  });
});
