/**
 * F7:BOM 详情页 KPI(lib/metrics 唯一查询层的一员)。
 * 口径全在 lib/domain/bom-detail.ts 的纯函数里;这里只取数。
 */
import { deriveBomKpis, type BomDetailKpis, type BomKpiLine } from "@/lib/domain/bom-detail";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface BomDetailMetric extends BomDetailKpis {
  versionCount: number;
  /** 阈值(租户配置),KPI 卡要显示出来 —— "需人工确认"没有阈值就没有意义 */
  threshold: number;
}

export async function bomDetailMetric(
  tenantId: string,
  bomId: string,
  versionId: string,
  threshold: number,
): Promise<BomDetailMetric> {
  const [versionCount, lines] = await Promise.all([
    prisma.bOMVersion.count({ where: tenantWhere(tenantId, { bomId }) }),
    prisma.bOMLine.findMany({
      where: tenantWhere(tenantId, { bomVersionId: versionId }),
      select: {
        id: true,
        decisions: { select: { decision: true } },
        matchCandidates: {
          select: { source: true, confidence: true },
          orderBy: { confidence: "desc" },
        },
      },
    }),
  ]);

  const kpiLines: BomKpiLine[] = lines.map((l) => ({
    id: l.id,
    decision: (l.decisions[0]?.decision as BomKpiLine["decision"]) ?? null,
    candidates: l.matchCandidates.map((c) => ({ source: c.source, confidence: Number(c.confidence) })),
  }));

  return { ...deriveBomKpis(kpiLines, threshold), versionCount, threshold };
}
