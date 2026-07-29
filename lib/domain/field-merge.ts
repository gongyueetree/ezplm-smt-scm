/**
 * 缺失字段的多源回填(纯函数,可完全单测)。
 *
 * 场景:一颗料的信息散在几个源里 ——
 * ezPLM 有工程属性但覆盖面窄(白名单原厂库),
 * DigiKey/Mouser 有描述/封装/生命周期/合规但没有内部编码。
 * 需要把它们按优先级合起来,**只补空,不覆盖**。
 *
 * 三条纪律:
 * 1. **绝不覆盖已有值** —— 客户 BOM 上写的制造商就是客户的意思,
 *    外部源说得再"权威"也不能改;
 * 2. **每个字段都带来源** —— 采购看到"封装 0402"必须知道它是客户给的
 *    还是 DigiKey 反查来的,这两者的可信度完全不同;
 * 3. **不猜** —— 所有源都没有就是 null,不用"常见值"填。
 */

/** 可回填的字段 */
export type EnrichableField =
  | "manufacturer"
  | "description"
  | "footprint"
  | "lifecycle"
  | "rohs"
  | "reach"
  | "packaging"
  | "msl";

export type FieldValue = string | boolean | null | undefined;

export interface FieldSource {
  /** 来源标识:BOM / EZPLM / DIGIKEY / MOUSER / LOCAL */
  name: string;
  values: Partial<Record<EnrichableField, FieldValue>>;
}

export interface MergedField {
  value: string | boolean | null;
  /** 该值来自哪个源;null 表示所有源都没有 */
  source: string | null;
}

export type MergedFields = Record<EnrichableField, MergedField>;

const FIELDS: EnrichableField[] = [
  "manufacturer",
  "description",
  "footprint",
  "lifecycle",
  "rohs",
  "reach",
  "packaging",
  "msl",
];

/** 有效值:空串、空白、UNKNOWN 都算"没有" */
export function hasValue(v: FieldValue): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return true;
  const t = String(v).trim();
  if (t === "") return false;
  // 生命周期的 UNKNOWN 是"不知道",不是一个值 —— 不能用它把后面的源挡住
  if (t.toUpperCase() === "UNKNOWN") return false;
  return true;
}

/**
 * 按源的先后顺序合并:**排在前面的源优先**。
 * 调用方负责把"更可信的源"放前面(通常:BOM 原文 → 本地库 → ezPLM → 分销商)。
 */
export function mergeFields(sources: readonly FieldSource[]): MergedFields {
  const out = {} as MergedFields;
  for (const field of FIELDS) {
    let picked: MergedField = { value: null, source: null };
    for (const src of sources) {
      const v = src.values[field];
      if (hasValue(v)) {
        picked = { value: typeof v === "boolean" ? v : String(v).trim(), source: src.name };
        break;
      }
    }
    out[field] = picked;
  }
  return out;
}

/** 哪些字段是被外部源补上的(用于 UI 提示与审计) */
export function backfilledFields(
  merged: MergedFields,
  primarySource: string,
): { field: EnrichableField; source: string }[] {
  return FIELDS.filter((f) => merged[f].source !== null && merged[f].source !== primarySource).map(
    (f) => ({ field: f, source: merged[f].source! }),
  );
}

/** 仍然缺失的字段(所有源都没有) */
export function missingFieldsAfterMerge(merged: MergedFields): EnrichableField[] {
  return FIELDS.filter((f) => merged[f].source === null);
}

export const FIELD_LABELS: Record<EnrichableField, string> = {
  manufacturer: "制造商",
  description: "描述",
  footprint: "封装",
  lifecycle: "生命周期",
  rohs: "RoHS",
  reach: "REACH",
  packaging: "包装",
  msl: "MSL",
};
