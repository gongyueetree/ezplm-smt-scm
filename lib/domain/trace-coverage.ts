/**
 * 追溯数据覆盖率与结论置信度(纯函数)。
 *
 * 为什么需要:影响面报告会被用来做**隔离与召回决策**。
 * 一份"影响 3 个客户"的报告,在数据完整时和在只导了收料模板时,
 * 含义完全不同 —— 后者可能真实影响 30 个客户,只是看不见。
 *
 * 所以每份影响面结果都必须带上"这份结论有多可信",
 * 并且**低置信度要显式说明缺什么**,而不是给个分数了事。
 *
 * 纪律:
 * - 覆盖率按**链路分段**算,不按节点总数 —— 缺一整段(如工单用料)
 *   比某几个节点缺字段严重得多;
 * - **没有数据 ≠ 覆盖率 100%**。空图的置信度是 LOW,不是 HIGH;
 * - 置信度只用三档,不给两位小数的假精度。
 */

export type TraceConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export const CONFIDENCE_LABEL: Record<TraceConfidenceLevel, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

/** 链路分段 —— 覆盖率按段算 */
export const TRACE_SEGMENTS = ["RECEIPT", "ISSUE", "PRODUCTION", "SHIPMENT"] as const;
export type TraceSegment = (typeof TRACE_SEGMENTS)[number];

export const SEGMENT_LABEL: Record<TraceSegment, string> = {
  RECEIPT: "收料",
  ISSUE: "发料",
  PRODUCTION: "生产产出",
  SHIPMENT: "出货",
};

export interface SegmentStat {
  segment: TraceSegment;
  /** 该段**预期**应有的关系数(由上游节点数推出) */
  expected: number;
  /** 实际有的关系数 */
  actual: number;
  /** 覆盖率 0–1;expected=0 时为 null(**不是 1**:没有预期不代表覆盖完整) */
  coverage: number | null;
}

export interface CoverageInput {
  segments: readonly SegmentStat[];
  /** 有时间戳的边占比 0–1;不可知为 null */
  timeCompleteness: number | null;
  /** 数量可折算的边占比 0–1;不可知为 null */
  quantityCompleteness: number | null;
  /** 数据缺口数量(来自 trace-graph 的 detectGaps) */
  gapCount: number;
}

export interface CoverageResult {
  /** 0–100 综合分,仅用于排序 */
  score: number;
  confidence: TraceConfidenceLevel;
  segments: SegmentStat[];
  timeCompleteness: number | null;
  quantityCompleteness: number | null;
  /** 人可读的判定依据 —— 低置信度必须说清缺什么 */
  reasons: string[];
  /** 完全没有数据的段 */
  missingSegments: TraceSegment[];
}

function pct(v: number | null): string {
  return v === null ? "未知" : `${Math.round(v * 100)}%`;
}

export function computeCoverage(input: CoverageInput): CoverageResult {
  const reasons: string[] = [];
  const missing: TraceSegment[] = [];

  const segments = input.segments.map((s) => ({
    ...s,
    coverage: s.expected === 0 ? null : Math.min(1, s.actual / s.expected),
  }));

  for (const s of segments) {
    if (s.expected > 0 && s.actual === 0) {
      missing.push(s.segment);
      reasons.push(`「${SEGMENT_LABEL[s.segment]}」段完全没有数据 —— 该段下游的影响**不可见**`);
    } else if (s.coverage !== null && s.coverage < 0.8) {
      reasons.push(`「${SEGMENT_LABEL[s.segment]}」段覆盖率仅 ${pct(s.coverage)}`);
    }
  }

  const known = segments.filter((s) => s.coverage !== null);
  // 空图:没有任何可评估的段 → LOW,不是 HIGH
  if (known.length === 0) {
    return {
      score: 0,
      confidence: "LOW",
      segments,
      timeCompleteness: input.timeCompleteness,
      quantityCompleteness: input.quantityCompleteness,
      reasons: ["没有任何可评估的链路数据 —— 结论不可依赖,请先导入追溯模板"],
      missingSegments: [...TRACE_SEGMENTS],
    };
  }

  const avgSegment = known.reduce((a, s) => a + (s.coverage ?? 0), 0) / known.length;

  // 加权:链路完整最重要(60%),数量其次(25%),时间(15%)
  const q = input.quantityCompleteness;
  const t = input.timeCompleteness;
  if (q !== null && q < 0.8) reasons.push(`仅 ${pct(q)} 的关系有可折算的数量`);
  if (t !== null && t < 0.8) reasons.push(`仅 ${pct(t)} 的关系有时间戳`);
  if (input.gapCount > 0) reasons.push(`存在 ${input.gapCount} 处数据缺口`);

  const score = Math.round(
    (avgSegment * 0.6 + (q ?? 0.5) * 0.25 + (t ?? 0.5) * 0.15) * 100,
  );

  // 判定用明确规则,不靠一个综合分一刀切。
  //
  // 关键:**单段覆盖率必须单独约束**。加权平均会掩盖单段塌陷 ——
  // 四段里三段满分、一段只有 60%,平均仍有 90 分,
  // 但那 40% 缺失意味着这一段下游的影响**完全看不见**,
  // 此时给 HIGH(「可直接用于隔离与通知决策」)是危险的。
  const worstSegment = known.reduce((m, s) => Math.min(m, s.coverage ?? 1), 1);

  let confidence: TraceConfidenceLevel;
  if (missing.length > 0 || worstSegment < 0.5) {
    confidence = "LOW";
  } else if (worstSegment < 0.9 || input.gapCount > 0 || score < 80) {
    // 有任何一段不完整,最高只能到 MEDIUM
    confidence = score >= 55 ? "MEDIUM" : "LOW";
  } else {
    confidence = "HIGH";
  }

  if (reasons.length === 0) reasons.push("各段链路完整、数量与时间齐备");

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence,
    segments,
    timeCompleteness: t,
    quantityCompleteness: q,
    reasons,
    missingSegments: missing,
  };
}

/**
 * 置信度对结论措辞的约束。
 *
 * 低置信度时**不得**给出"未影响任何客户"这类断言 ——
 * 只能说"在现有数据范围内未见影响"。这条差别在客诉场景下是致命的。
 */
export function conclusionCaveat(confidence: TraceConfidenceLevel): string {
  switch (confidence) {
    case "HIGH":
      return "数据完整,结论可直接用于隔离与通知决策";
    case "MEDIUM":
      return "数据存在缺口,结论可作参考;下结论前建议补齐标注的缺失段";
    case "LOW":
      return "数据严重不足 —— 本结论**只反映已导入数据的范围**,不代表真实影响面;不得据此判定「无影响」";
  }
}
