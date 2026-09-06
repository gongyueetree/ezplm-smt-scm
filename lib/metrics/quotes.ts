/**
 * F1 · lib/metrics:报价域 KPI —— **唯一查询层**。
 * 管理看板与后续 F6 品质看板/F2 ECN KPI 一律消费本目录,不各算一套。
 * 汇总逻辑仍在 lib/domain(纯函数),这里只负责带 tenant scope 取数。
 */
import {
  deriveQuoteStats,
  type QuoteStatRow,
} from "@/lib/domain/management-kpi";
import { computeGrossMargin, type GrossMarginResult } from "@/lib/domain/quote-margin";
import { summarizeConversion, type OutcomeRow, type QuoteOutcomeValue } from "@/lib/domain/quote-outcome";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

const CAP = 1000;
const CONV_CAP = 2000;

export async function quoteStatsMetric(tenantId: string) {
  const versions = await prisma.quoteVersion.findMany({
    where: tenantWhere(tenantId),
    select: { status: true, currency: true, approvedSnapshot: true, submittedSnapshot: true },
    take: CAP + 1,
  });
  const truncated = versions.length > CAP;
  const rows: QuoteStatRow[] = versions.slice(0, CAP).map((v) => {
    const snap = (v.approvedSnapshot ?? v.submittedSnapshot) as
      | { summary?: { grandTotal?: string; currency?: string } }
      | null;
    return {
      status: v.status as QuoteStatRow["status"],
      // 金额只取冻结快照;无快照记 null,不重算充数
      grandTotal: snap?.summary?.grandTotal ?? null,
      currency: snap?.summary?.currency ?? v.currency,
    };
  });
  return { stats: deriveQuoteStats(rows), truncated };
}

export async function orderConversionMetric(tenantId: string) {
  const quotes = await prisma.quote.findMany({
    where: tenantWhere(tenantId),
    select: {
      outcome: true,
      versions: {
        where: { status: "APPROVED" as const },
        orderBy: { revision: "desc" },
        take: 1,
        select: { approvedSnapshot: true, currency: true },
      },
    },
    take: CONV_CAP + 1,
  });
  const truncated = quotes.length > CONV_CAP;
  const rows: OutcomeRow[] = quotes.slice(0, CONV_CAP).map((q) => {
    const snap = q.versions[0]?.approvedSnapshot as
      | { summary?: { grandTotal?: string; currency?: string } }
      | null;
    return {
      outcome: q.outcome as QuoteOutcomeValue,
      amount: snap?.summary?.grandTotal ?? null,
      currency: snap?.summary?.currency ?? q.versions[0]?.currency ?? "CNY",
    };
  });
  return { conversion: summarizeConversion(rows), truncated };
}

/**
 * 毛利:收入取审批快照冻结总价;**成本取冻结版本的 QuoteLine 原始行** ——
 * 快照里 null 成本会被写成 "0",从快照算会把缺成本当零成本,毛利虚高
 * (陷阱详见 lib/domain/quote-margin.ts 头注)。冻结纪律保证两者一致。
 */
export async function grossMarginMetric(
  tenantId: string,
): Promise<{ margin: GrossMarginResult; truncated: boolean }> {
  const versions = await prisma.quoteVersion.findMany({
    where: tenantWhere(tenantId, { status: "APPROVED" as const }),
    select: {
      currency: true,
      approvedSnapshot: true,
      quote: { select: { code: true } },
      lines: { select: { qty: true, purchaseCost: true } },
    },
    orderBy: { approvedAt: "desc" },
    take: CAP + 1,
  });
  const truncated = versions.length > CAP;
  const margin = computeGrossMargin(
    versions.slice(0, CAP).map((v) => {
      const snap = v.approvedSnapshot as { summary?: { grandTotal?: string; currency?: string } } | null;
      return {
        quoteCode: v.quote.code,
        currency: snap?.summary?.currency ?? v.currency,
        grandTotal: snap?.summary?.grandTotal ?? "",
        lines: v.lines.map((l) => ({
          qty: l.qty === null ? null : String(l.qty),
          purchaseCost: l.purchaseCost === null ? null : String(l.purchaseCost),
        })),
      };
    }),
  );
  return { margin, truncated };
}
