/** F1 · lib/metrics:库存域 KPI(DC Aging / 呆滞 / 数据新鲜度) */
import {
  deriveDcAging,
  deriveSlowMoving,
  type InventoryAgingRow,
} from "@/lib/domain/management-kpi";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

const CAP = 1000;

export async function inventoryMetrics(tenantId: string, now: string) {
  const parts = await prisma.part.findMany({ where: tenantWhere(tenantId), take: CAP });
  const snapshots = await prisma.inventorySnapshot.findMany({
    where: tenantWhere(tenantId, { partId: { in: parts.map((p) => p.id) } }),
    orderBy: { fetchedAt: "desc" },
  });
  const latestByPart = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (s.partId && !latestByPart.has(s.partId)) latestByPart.set(s.partId, s);
  }

  const rows: InventoryAgingRow[] = parts.map((p) => {
    const snap = latestByPart.get(p.id);
    return {
      partId: p.id,
      mpn: p.mpn,
      qtyOnHand: snap ? Number(snap.qtyOnHand) : 0,
      qtySlowMoving:
        snap?.qtySlowMoving === null || snap?.qtySlowMoving === undefined
          ? null
          : Number(snap.qtySlowMoving),
      dateCode: p.dateCode,
      fetchedAt: snap?.fetchedAt.toISOString() ?? now,
    };
  });

  return {
    aging: deriveDcAging(rows, now),
    slowMoving: deriveSlowMoving(rows),
    inventoryFetchedAt: snapshots[0]?.fetchedAt.toISOString() ?? null,
  };
}
