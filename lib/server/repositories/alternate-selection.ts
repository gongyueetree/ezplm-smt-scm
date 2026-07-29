/**
 * 替代料候选清单的读写。
 *
 * 纪律:
 * - 全部经 tenantWhere / tenantData 守卫(CLAUDE.md 数据访问约定);
 * - 勾选是**人工动作**,记 userId 与时间,并落 AuditLog;
 * - 存的是"当时的评分快照",评分算法以后改了也不影响事后追溯 ——
 *   否则回看时会看到一个与当初决策不一致的分数。
 */
import type { Prisma } from "@prisma/client";
import type { MarketSummary } from "@/lib/domain/market-summary";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export interface AlternateSelectionInput {
  alternateMpn: string;
  manufacturer?: string | null;
  mode: string;
  technical: number;
  evidence: number;
  sourceTrust: number;
  confidence: number;
  reasons?: string[];
  warnings?: string[];
  market?: MarketSummary | null;
  note?: string | null;
}

export interface AlternateSelectionView {
  id: string;
  alternateMpn: string;
  manufacturer: string | null;
  mode: string;
  technical: number;
  evidence: number;
  sourceTrust: number;
  confidence: number;
  reasons: string[];
  warnings: string[];
  market: MarketSummary | null;
  note: string | null;
  selectedAt: string;
}

function toView(row: {
  id: string;
  alternateMpn: string;
  manufacturer: string | null;
  mode: string;
  technical: number;
  evidence: number;
  sourceTrust: number;
  confidence: number;
  reasons: unknown;
  warnings: unknown;
  market: unknown;
  note: string | null;
  selectedAt: Date;
}): AlternateSelectionView {
  return {
    id: row.id,
    alternateMpn: row.alternateMpn,
    manufacturer: row.manufacturer,
    mode: row.mode,
    technical: row.technical,
    evidence: row.evidence,
    sourceTrust: row.sourceTrust,
    confidence: row.confidence,
    reasons: Array.isArray(row.reasons) ? (row.reasons as string[]) : [],
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
    market: (row.market ?? null) as MarketSummary | null,
    note: row.note,
    selectedAt: row.selectedAt.toISOString(),
  };
}

export async function listAlternateSelections(
  session: SessionRef,
  mpn: string,
): Promise<AlternateSelectionView[]> {
  const rows = await prisma.alternateSelection.findMany({
    where: tenantWhere(session.tenantId, { mpn }),
    orderBy: [{ confidence: "desc" }, { alternateMpn: "asc" }],
  });
  return rows.map(toView);
}

export async function saveAlternateSelection(
  session: SessionRef,
  mpn: string,
  input: AlternateSelectionInput,
): Promise<AlternateSelectionView> {
  const payload = {
    manufacturer: input.manufacturer ?? null,
    mode: input.mode,
    technical: input.technical,
    evidence: input.evidence,
    sourceTrust: input.sourceTrust,
    confidence: input.confidence,
    reasons: (input.reasons ?? []) as unknown as Prisma.InputJsonValue,
    warnings: (input.warnings ?? []) as unknown as Prisma.InputJsonValue,
    market: (input.market ?? null) as unknown as Prisma.InputJsonValue,
    note: input.note ?? null,
    selectedById: session.userId,
    selectedAt: new Date(),
  };

  const row = await prisma.alternateSelection.upsert({
    where: {
      tenantId_mpn_alternateMpn: {
        tenantId: session.tenantId,
        mpn,
        alternateMpn: input.alternateMpn,
      },
    },
    update: payload,
    create: tenantData(session.tenantId, {
      mpn,
      alternateMpn: input.alternateMpn,
      ...payload,
    }),
  });

  await writeAudit(prisma, {
    tenantId: session.tenantId,
    userId: session.userId,
    action: "ALTERNATE_SELECTION_SAVE",
    entityType: "AlternateSelection",
    entityId: row.id,
    after: { mpn, alternateMpn: input.alternateMpn, mode: input.mode, confidence: input.confidence },
  });

  return toView(row);
}

export async function removeAlternateSelection(
  session: SessionRef,
  mpn: string,
  alternateMpn: string,
): Promise<boolean> {
  const existing = await prisma.alternateSelection.findFirst({
    where: tenantWhere(session.tenantId, { mpn, alternateMpn }),
    select: { id: true },
  });
  if (!existing) return false;

  await prisma.alternateSelection.delete({ where: { id: existing.id } });
  await writeAudit(prisma, {
    tenantId: session.tenantId,
    userId: session.userId,
    action: "ALTERNATE_SELECTION_REMOVE",
    entityType: "AlternateSelection",
    entityId: existing.id,
    before: { mpn, alternateMpn },
  });
  return true;
}
