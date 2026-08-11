/**
 * BOM 台账数据层:把台账指标需要的行级事实一次查好,交给纯函数算。
 *
 * 纪律:指标口径全在 `lib/domain/bom-ledger.ts`,这里只负责取数;
 * EOL 判定靠**本地物料库按 MPN 命中**,命中不到即"未知",不猜在产也不猜停产。
 */
import type { BomLedgerRow } from "@/lib/domain/bom-ledger";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface BomLedgerItem extends BomLedgerRow {
  /** 预 BOM / 正式 BOM(PR-C)。台账必须显示,否则两份同名的 BOM 分不清哪份能投产 */
  purpose: "PRE_QUOTE" | "PRODUCTION";
  /** 正式 BOM 的来源预 BOM;预 BOM 若已转出则记转出的正式 BOM 数 */
  convertedFromBomId: string | null;
  convertedToCount: number;
  /** 正式 BOM 里还没匹配到内部料号的行数 —— 量产前必须清零 */
  pendingInternalPnCount: number;
  rfqCode: string | null;
  rfqId: string | null;
  latestVersionId: string | null;
  previousVersionId: string | null;
  latestVersionNo: number | null;
  createdAt: string;
}

export async function loadBomLedger(
  session: SessionRef,
  filter: {
    customerId?: string | null;
    from?: string | null;
    to?: string | null;
    purpose?: "PRE_QUOTE" | "PRODUCTION" | null;
  } = {},
): Promise<BomLedgerItem[]> {
  const where: Record<string, unknown> = {};
  if (filter.customerId) where.customerId = filter.customerId;
  if (filter.purpose) where.purpose = filter.purpose;
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: new Date(filter.from) } : {}),
      ...(filter.to ? { lte: new Date(filter.to) } : {}),
    };
  }

  const boms = await prisma.bOM.findMany({
    where: tenantWhere(session.tenantId, where),
    orderBy: { createdAt: "desc" },
    include: {
      rfq: { select: { id: true, code: true } },
      _count: { select: { convertedTo: true } },
      versions: {
        orderBy: { versionNo: "desc" },
        take: 2,
        include: {
          lines: {
            select: {
              id: true,
              mpn: true,
              internalPartId: true,
              decisions: { select: { decision: true } },
            },
          },
          _count: { select: { lines: true } },
        },
      },
    },
  });

  // 一次性取回本地库的生命周期,避免 N+1
  const mpns = [
    ...new Set(
      boms.flatMap((b) => b.versions[0]?.lines.map((l) => l.mpn).filter(Boolean) ?? []),
    ),
  ] as string[];
  const parts = mpns.length
    ? await prisma.part.findMany({
        where: tenantWhere(session.tenantId, { mpn: { in: mpns } }),
        select: { mpn: true, lifecycle: true },
      })
    : [];
  const lifecycleByMpn = new Map(parts.map((p) => [p.mpn!, p.lifecycle]));

  return boms.map((b) => {
    const latest = b.versions[0] ?? null;
    const lines = latest?.lines ?? [];
    let eol = 0;
    let unknown = 0;
    let unconfirmed = 0;
    let noCandidate = 0;
    for (const l of lines) {
      const lc = l.mpn ? lifecycleByMpn.get(l.mpn) : undefined;
      if (lc === "EOL") eol += 1;
      else if (lc === undefined || lc === "UNKNOWN") unknown += 1;

      const d = l.decisions[0];
      if (!d) unconfirmed += 1;
      else if (d.decision === "NO_MATCH") noCandidate += 1;
    }

    return {
      bomId: b.id,
      name: b.name,
      customerId: b.customerId,
      latestVersionAt: latest ? latest.createdAt.toISOString() : null,
      lineCount: latest?._count.lines ?? 0,
      eolLineCount: eol,
      unknownLifecycleLineCount: unknown,
      unconfirmedLineCount: unconfirmed,
      noCandidateLineCount: noCandidate,
      purpose: b.purpose,
      convertedFromBomId: b.convertedFromBomId,
      convertedToCount: b._count.convertedTo,
      // 只有正式 BOM 才谈"待补内部料号";预 BOM 本来就不要求
      pendingInternalPnCount:
        b.purpose === "PRODUCTION" ? lines.filter((l) => l.internalPartId === null).length : 0,
      rfqCode: b.rfq?.code ?? null,
      rfqId: b.rfq?.id ?? null,
      latestVersionId: latest?.id ?? null,
      previousVersionId: b.versions[1]?.id ?? null,
      latestVersionNo: latest?.versionNo ?? null,
      createdAt: b.createdAt.toISOString(),
    };
  });
}
