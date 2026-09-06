/** F1 · lib/metrics:质量事件 KPI(E6 表)。F6 品质看板必须消费本函数,不另写聚合 */
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface QualityMetric {
  open: number;
  investigating: number;
  contained: number;
  closedThisMonth: number;
  customerComplaints: number;
  supplierIssues: number;
  total: number;
}

export async function qualityMetric(tenantId: string, now: string): Promise<QualityMetric> {
  const monthStart = new Date(`${now.slice(0, 7)}-01T00:00:00.000Z`);
  const [byStatus, byType, closedThisMonth] = await Promise.all([
    prisma.qualityIncident.groupBy({ by: ["status"], where: tenantWhere(tenantId), _count: { _all: true } }),
    prisma.qualityIncident.groupBy({ by: ["eventType"], where: tenantWhere(tenantId), _count: { _all: true } }),
    prisma.qualityIncident.count({
      where: tenantWhere(tenantId, { status: "CLOSED" as const, updatedAt: { gte: monthStart } }),
    }),
  ]);
  const st = Object.fromEntries(byStatus.map((b) => [b.status, b._count._all]));
  const ty = Object.fromEntries(byType.map((b) => [b.eventType, b._count._all]));
  return {
    open: st.OPEN ?? 0,
    investigating: st.INVESTIGATING ?? 0,
    contained: st.CONTAINED ?? 0,
    closedThisMonth,
    customerComplaints: ty.CUSTOMER_COMPLAINT ?? 0,
    supplierIssues: ty.SUPPLIER ?? 0,
    total: byStatus.reduce((n, b) => n + b._count._all, 0),
  };
}
