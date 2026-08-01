/**
 * 合规文档有效期分桶与预警(客户 docx:「ROHS, REACH, COC 的管控未列」)。
 *
 * 纪律(与库存 DC Aging、对账账龄同一条教训):
 * - **未标注有效期 ≠ 长期有效**。没填有效期的文档单列一档,
 *   绝不并入「有效」—— 否则一份可能早就过期的 RoHS 报告会显示成最健康的那种;
 * - 只算不判:给出档位与天数,不给「可以出货 / 不可出货」这类结论,那是品质的判断;
 * - 缺文档与文档过期是**两件事**,分别统计。
 */

export const DOC_EXPIRY_BUCKETS = [
  "已过期",
  "30天内到期",
  "90天内到期",
  "有效",
  "未标注有效期",
] as const;

export type DocExpiryBucket = (typeof DOC_EXPIRY_BUCKETS)[number];

/** 需要管控有效期的合规文档类型 */
export const COMPLIANCE_DOC_KINDS = ["ROHS_REPORT", "REACH_REPORT", "COC"] as const;
export type ComplianceDocKind = (typeof COMPLIANCE_DOC_KINDS)[number];

export const DOC_KIND_LABEL: Record<string, string> = {
  DATASHEET: "数据手册",
  APPROVAL_SHEET: "承认书",
  ROHS_REPORT: "RoHS 报告",
  REACH_REPORT: "REACH 报告",
  COC: "COC",
  OTHER: "其它",
};

const MS_PER_DAY = 86_400_000;

function dayStart(iso: string): number | null {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00.000Z`);
  return Number.isFinite(t) ? t : null;
}

/** 距到期还有多少天;已过期为负数;日期不可解析或未填返回 null */
export function daysUntilExpiry(validUntil: string | null, asOf: string): number | null {
  if (!validUntil) return null;
  const due = dayStart(validUntil);
  const now = dayStart(asOf);
  if (due === null || now === null) return null;
  return Math.round((due - now) / MS_PER_DAY);
}

export function expiryBucket(validUntil: string | null, asOf: string): DocExpiryBucket {
  const days = daysUntilExpiry(validUntil, asOf);
  if (days === null) return "未标注有效期";
  if (days < 0) return "已过期";
  if (days <= 30) return "30天内到期";
  if (days <= 90) return "90天内到期";
  return "有效";
}

/** 档位对应的风险色 —— 未标注按**告警**处理,不按正常 */
export function expiryTone(bucket: DocExpiryBucket): "red" | "amber" | "blue" | "green" {
  switch (bucket) {
    case "已过期":
      return "red";
    case "30天内到期":
      return "amber";
    case "90天内到期":
      return "blue";
    case "未标注有效期":
      // 未知不是好消息:按告警显示,促使人去补
      return "amber";
    default:
      return "green";
  }
}

export interface DocRef {
  partId: string;
  internalPn: string;
  kind: string;
  validUntil: string | null;
}

export interface ComplianceSummary {
  buckets: { bucket: DocExpiryBucket; count: number }[];
  /** 已过期 + 30 天内到期 —— 需要立刻处理的 */
  urgentCount: number;
  /** 未标注有效期的份数(单独暴露,说明这部分状态不可知) */
  unknownCount: number;
  /** 完全没有该类合规文档的物料数(与"文档过期"是两件事) */
  missingByKind: { kind: ComplianceDocKind; missingParts: number }[];
}

export function summarizeCompliance(
  docs: readonly DocRef[],
  allPartIds: readonly string[],
  asOf: string,
): ComplianceSummary {
  const counts = new Map<DocExpiryBucket, number>();
  for (const b of DOC_EXPIRY_BUCKETS) counts.set(b, 0);

  const complianceDocs = docs.filter((d) =>
    (COMPLIANCE_DOC_KINDS as readonly string[]).includes(d.kind),
  );
  for (const d of complianceDocs) {
    const b = expiryBucket(d.validUntil, asOf);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }

  const missingByKind = COMPLIANCE_DOC_KINDS.map((kind) => {
    const have = new Set(complianceDocs.filter((d) => d.kind === kind).map((d) => d.partId));
    return { kind, missingParts: allPartIds.filter((p) => !have.has(p)).length };
  });

  return {
    buckets: DOC_EXPIRY_BUCKETS.map((b) => ({ bucket: b, count: counts.get(b) ?? 0 })),
    urgentCount: (counts.get("已过期") ?? 0) + (counts.get("30天内到期") ?? 0),
    unknownCount: counts.get("未标注有效期") ?? 0,
    missingByKind,
  };
}
