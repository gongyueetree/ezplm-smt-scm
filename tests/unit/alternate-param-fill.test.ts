/**
 * R0-3:替代料候选的参数填充。
 *
 * 缺陷现场:alternate-search 的 valuesFrom() 只在 key === "package" 时填值,
 * 其余约束一律 null(`void source.description` 说明当初就是留空的)。
 * 于是 LOCAL 与 DIGIKEY 来源的候选:
 *   technical 恒等于封装单项得分,evidence 恒等于封装约束的权重占比,
 * 界面上四个维度看起来都算过了,实际只有一维是真的。
 *
 * 这里锁住「把本地属性行填进参数表」的纯规则,包括**取数来源可信度**:
 * AI 提取且未经人工确认的值不能当作本地权威数据(schema 注释即此纪律)。
 */
import { describe, expect, it } from "vitest";
import { fillValuesFromAttributes, type PartAttributeRow } from "@/lib/domain/alternate-param-fill";

const constraints = [
  { key: "package", label: "封装" },
  { key: "p_1", label: "主频" },
  { key: "p_2", label: "Flash" },
  { key: "p_3", label: "工作电压" },
];

const attr = (over: Partial<PartAttributeRow>): PartAttributeRow => ({
  label: "主频",
  value: "72",
  unit: "MHz",
  source: "MANUAL",
  confirmed: true,
  ...over,
});

describe("R0-3 fillValuesFromAttributes", () => {
  it("按参数名匹配填值,并把单位拼回去(供 param-compare 解析量纲)", () => {
    const { values } = fillValuesFromAttributes(constraints, [attr({})]);
    expect(values.p_1).toBe("72 MHz");
  });

  it("没有单位时只填值,不造一个空格出来", () => {
    const { values } = fillValuesFromAttributes(constraints, [
      attr({ label: "Flash", value: "128", unit: null }),
    ]);
    expect(values.p_2).toBe("128");
  });

  it("**package 不由属性表填** —— 封装另有 footprint 来源,避免两处打架", () => {
    const { values } = fillValuesFromAttributes(constraints, [
      attr({ label: "封装", value: "LQFP-48", unit: null }),
    ]);
    expect(values.package).toBeUndefined();
  });

  it("匹配不上的属性不produce噪声;未命中的约束保持 null(= 缺失,不是 0)", () => {
    const { values } = fillValuesFromAttributes(constraints, [
      attr({ label: "某个无关属性", value: "x", unit: null }),
    ]);
    expect(values.p_1).toBeNull();
    expect(values.p_2).toBeNull();
    expect(values.p_3).toBeNull();
  });

  it("空值属性视同未提供,不落成空串", () => {
    const { values } = fillValuesFromAttributes(constraints, [
      attr({ value: "", unit: null }),
      attr({ label: "Flash", value: null, unit: null }),
    ]);
    expect(values.p_1).toBeNull();
    expect(values.p_2).toBeNull();
  });

  it("人工/ERP/ezPLM 来源记为可追溯来源;**AI 提取且未确认降级为 AI_SEARCH**", () => {
    const { sources } = fillValuesFromAttributes(constraints, [
      attr({ label: "主频", source: "MANUAL", confirmed: true }),
      attr({ label: "Flash", value: "128", unit: "KB", source: "AI_EXTRACT", confirmed: false }),
      attr({ label: "工作电压", value: "3.3", unit: "V", source: "EZPLM", confirmed: true }),
    ]);
    expect(sources.p_1).toBe("LOCAL");
    expect(sources.p_2).toBe("AI_SEARCH");
    expect(sources.p_3).toBe("EZPLM");
  });

  it("AI 提取但**已经过人工确认** → 可以按本地权威计", () => {
    const { sources } = fillValuesFromAttributes(constraints, [
      attr({ label: "主频", source: "AI_EXTRACT", confirmed: true }),
    ]);
    expect(sources.p_1).toBe("LOCAL");
  });
});
