/**
 * R0-3:把一颗料的属性行填进替代料评分的参数表(纯函数)。
 *
 * 之前 LOCAL / DIGIKEY 候选的参数表**除封装外全是 null**,
 * 导致这两个来源的技术分恒等于封装单项分 —— 四维分数只有一维是真的。
 * 本模块负责「有什么就填什么,并如实标注这条值的来源可信度」。
 *
 * 两条纪律:
 * 1. 填不上就是 `null`(= 缺失),**绝不编一个值**,也不落成空串;
 * 2. AI 提取且**未经人工确认**的值不能按本地权威计
 *    (PartAttributeValue.confirmed 的 schema 注释即此要求),
 *    降级为 AI_SEARCH,由 SOURCE_TRUST 给 0.45 的低权重。
 */
import type { EvidenceSource } from "./alternate-score";
import { matchParamName } from "./param-compare";

/** 一行物料属性(来自 PartAttributeValue + 其 definition) */
export interface PartAttributeRow {
  /** 属性显示名(definition.label) */
  label: string;
  value: string | null;
  /** definition.unit;有则拼回值里,供 param-compare 解析量纲 */
  unit: string | null;
  /** MANUAL / EZPLM / AI_EXTRACT / ERP / IMPORT */
  source: string;
  confirmed: boolean;
}

export interface ConstraintRef {
  key: string;
  label: string;
}

/**
 * 判定一条属性值的取数来源。
 * AI 提取未确认 → AI_SEARCH(低可信);其余按各自来源。
 */
export function evidenceSourceOf(row: PartAttributeRow): EvidenceSource {
  if (row.source === "AI_EXTRACT" && !row.confirmed) return "AI_SEARCH";
  if (row.source === "EZPLM") return "EZPLM";
  return "LOCAL";
}

/**
 * 按约束把属性行填进参数表。
 *
 * `package` **不由这里填** —— 封装另有 footprint 来源(且要走封装语义比较),
 * 两处都填会互相打架。
 */
export function fillValuesFromAttributes(
  constraints: readonly ConstraintRef[],
  attributes: readonly PartAttributeRow[],
): { values: Record<string, string | null>; sources: Record<string, EvidenceSource> } {
  const values: Record<string, string | null> = {};
  const sources: Record<string, EvidenceSource> = {};

  for (const c of constraints) {
    if (c.key === "package") continue;
    values[c.key] = null;

    const hit = attributes.find(
      (a) => a.value !== null && a.value.trim() !== "" && matchParamName(c.label, a.label),
    );
    if (!hit) continue;

    const v = hit.value!.trim();
    values[c.key] = hit.unit && hit.unit.trim() !== "" ? `${v} ${hit.unit.trim()}` : v;
    sources[c.key] = evidenceSourceOf(hit);
  }
  return { values, sources };
}
