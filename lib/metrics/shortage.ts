/** F1 · lib/metrics:缺料 KPI(缺料单驱动口径,PR-B 表) */
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export async function shortageMetric(tenantId: string) {
  const byStatus = await prisma.shortageSheetLine.groupBy({
    by: ["status"],
    where: tenantWhere(tenantId),
    _count: { _all: true },
  });
  const m = Object.fromEntries(byStatus.map((b) => [b.status, b._count._all]));
  const open = (m.OPEN ?? 0) + (m.CALL_CREATED ?? 0) + (m.SENT_TO_SUPPLIER ?? 0) + (m.PARTIALLY_RESOLVED ?? 0);
  return {
    openLines: open,
    resolvedLines: m.RESOLVED ?? 0,
    totalLines: byStatus.reduce((n, b) => n + b._count._all, 0),
  };
}
