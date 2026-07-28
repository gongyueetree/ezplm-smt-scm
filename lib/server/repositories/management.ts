/**
 * 管理工作台 KPI 取数(SPEC §16)。
 * 只取明细,汇总一律由 lib/domain/management-kpi.ts 与 lib/domain/opo.ts 派生。
 */
import { deriveOpoKpi } from "@/lib/domain/opo";
import {
  deriveDcAging,
  deriveQuoteStats,
  deriveSlowMoving,
  type InventoryAgingRow,
  type QuoteStatRow,
} from "@/lib/domain/management-kpi";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { loadOpoLines } from "./opo";

export interface ManagementSnapshot {
  quotes: ReturnType<typeof deriveQuoteStats>;
  opo: ReturnType<typeof deriveOpoKpi>;
  aging: ReturnType<typeof deriveDcAging>;
  slowMoving: ReturnType<typeof deriveSlowMoving>;
  /** 库存缓存的最新时点;无数据为 null(诚实展示数据新鲜度) */
  inventoryFetchedAt: string | null;
}

export async function getManagementSnapshot(
  tenantId: string,
  now: string,
): Promise<ManagementSnapshot> {
  const [versions, parts, opoLines] = await Promise.all([
    prisma.quoteVersion.findMany({
      where: tenantWhere(tenantId),
      select: {
        status: true,
        currency: true,
        approvedSnapshot: true,
        submittedSnapshot: true,
        lines: { select: { qty: true, purchaseCost: true, markupPct: true, customerPrice: true } },
      },
      take: 1000,
    }),
    prisma.part.findMany({ where: tenantWhere(tenantId), take: 1000 }),
    loadOpoLines(tenantId),
  ]);

  // 报价金额优先取快照(已批准/已提交冻结值),没有快照的版本金额记 null 而不是重算充数
  const quoteRows: QuoteStatRow[] = versions.map((v) => {
    const snap = (v.approvedSnapshot ?? v.submittedSnapshot) as
      | { summary?: { grandTotal?: string; currency?: string } }
      | null;
    return {
      status: v.status as QuoteStatRow["status"],
      grandTotal: snap?.summary?.grandTotal ?? null,
      currency: snap?.summary?.currency ?? v.currency,
    };
  });

  const snapshots = await prisma.inventorySnapshot.findMany({
    where: tenantWhere(tenantId, { partId: { in: parts.map((p) => p.id) } }),
    orderBy: { fetchedAt: "desc" },
  });
  const latestByPart = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) if (!latestByPart.has(s.partId)) latestByPart.set(s.partId, s);

  const invRows: InventoryAgingRow[] = parts.map((p) => {
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
    quotes: deriveQuoteStats(quoteRows),
    opo: deriveOpoKpi(opoLines, now),
    aging: deriveDcAging(invRows, now),
    slowMoving: deriveSlowMoving(invRows),
    inventoryFetchedAt: snapshots[0]?.fetchedAt.toISOString() ?? null,
  };
}
