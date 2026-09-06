/**
 * F1 · lib/metrics:损耗 KPI(当月)。
 * 金额依赖标准价:未维护标准价的按「金额未知」计数,**不按 0 算** ——
 * 与 /scrap 报表同一口径(groupScrapWithAmount)。
 */
import { groupScrapWithAmount, type ScrapRow } from "@/lib/domain/scrap-report";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface ScrapLossMetric {
  period: string;
  recordCount: number;
  scrapQty: string;
  /** 金额(仅覆盖已维护标准价的部分);null = 一条都算不了 */
  amount: string | null;
  amountCurrency: string | null;
  /** 没有标准价、金额未知的记录数 —— 界面必须并列显示 */
  unpricedCount: number;
}

export async function scrapLossMetric(tenantId: string, period: string): Promise<ScrapLossMetric> {
  const records = await prisma.scrapRecord.findMany({
    where: tenantWhere(tenantId, { period }),
    select: { period: true, customerId: true, workOrder: true, mpn: true, issuedQty: true, scrapQty: true, reason: true },
  });
  const rows: ScrapRow[] = records.map((r) => ({
    period: r.period,
    customerId: r.customerId,
    workOrder: r.workOrder,
    mpn: r.mpn,
    issuedQty: String(r.issuedQty),
    scrapQty: String(r.scrapQty),
    reason: r.reason,
  }));

  const mpns = [...new Set(rows.map((r) => r.mpn).filter((m): m is string => !!m))];
  const parts = mpns.length
    ? await prisma.part.findMany({
        where: tenantWhere(tenantId, { mpn: { in: mpns } }),
        select: { mpn: true, standardCost: true, standardCostCurrency: true },
      })
    : [];
  const costByMpn = new Map(
    parts
      .filter((p) => p.standardCost !== null)
      .map((p) => [p.mpn!, { unitCost: String(p.standardCost), currency: p.standardCostCurrency ?? "CNY" }]),
  );

  const groups = groupScrapWithAmount(rows, "period", (mpn) =>
    mpn ? costByMpn.get(mpn) ?? null : null,
  );
  const g = groups.find((x) => x.key === period);
  return {
    period,
    recordCount: rows.length,
    scrapQty: g?.scrapQty ?? "0",
    amount: g?.scrapAmount ?? null,
    amountCurrency: g?.currency ?? null,
    unpricedCount: g?.rowsWithoutCost ?? rows.length,
  };
}
