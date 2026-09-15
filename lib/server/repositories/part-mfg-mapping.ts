/**
 * R4-2:PartMfgMapping 仓储 —— 证据 upsert / 人工审批 / preferred MPN 同步守卫。
 *
 * 纪律:
 * - 证据 upsert 按唯一键去重,重复出现只 bump evidenceCount/lastSeenAt(不覆盖既有状态);
 * - PO_HISTORY 永远 CANDIDATE/HISTORICAL(§22),状态升级只能走人工 approve;
 * - Part.mpn 同步:whyCannotSyncPreferredMpn 全过 + 显式请求才写(§23);
 * - 一切写动作 AuditLog;审计载荷不带整行源数据。
 */
import type { Prisma, PartMfgMappingSource, PartMfgMappingStatus, PartMfgRelationType } from "@prisma/client";
import {
  manufacturerKeyOf,
  mfgPartNoKey,
  whyCannotSyncPreferredMpn,
} from "@/lib/domain/part-mfg";
import type {
  IdentifierKind,
  IdentifierMatchMode,
  MaterialKind,
} from "@/lib/integration/erp/canonical/types";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export interface MfgEvidenceInput {
  partId: string;
  rawManufacturer: string | null;
  rawManufacturerPartNo: string;
  materialKind: MaterialKind;
  identifierKind: IdentifierKind;
  identifierMatchMode: IdentifierMatchMode;
  relationType: PartMfgRelationType;
  status: PartMfgMappingStatus;
  source: PartMfgMappingSource;
  sourceDocumentNo?: string | null;
  sourceLineId?: string | null;
  sourceRow?: number | null;
  sourceCreatedAt?: string | null;
}

/**
 * 证据 upsert:同 (part, mpnKey, mfgKey) 已存在 → 只 bump evidenceCount/lastSeenAt
 * (且**不**降级/覆盖已有 status/relationType —— 人工审批结果不被后续导入冲掉);
 * 不存在 → 按输入档位创建。返回 { id, created }。
 */
export async function upsertMfgEvidence(
  db: Prisma.TransactionClient,
  tenantId: string,
  input: MfgEvidenceInput,
): Promise<{ id: string; created: boolean }> {
  const manufacturerPartNoKey = mfgPartNoKey(input.rawManufacturerPartNo);
  const manufacturerKey = manufacturerKeyOf(input.rawManufacturer);
  const existing = await db.partMfgMapping.findUnique({
    where: {
      tenantId_partId_manufacturerPartNoKey_manufacturerKey: {
        tenantId,
        partId: input.partId,
        manufacturerPartNoKey,
        manufacturerKey,
      },
    },
    select: { id: true },
  });
  if (existing) {
    await db.partMfgMapping.update({
      where: { id: existing.id },
      data: { evidenceCount: { increment: 1 }, lastSeenAt: new Date() },
    });
    return { id: existing.id, created: false };
  }
  const row = await db.partMfgMapping.create({
    data: tenantData(tenantId, {
      partId: input.partId,
      rawManufacturer: input.rawManufacturer,
      rawManufacturerPartNo: input.rawManufacturerPartNo,
      manufacturerPartNo: input.rawManufacturerPartNo,
      manufacturerPartNoKey,
      manufacturerKey,
      materialKind: input.materialKind,
      identifierKind: input.identifierKind,
      identifierMatchMode: input.identifierMatchMode,
      relationType: input.relationType,
      status: input.status,
      source: input.source,
      sourceDocumentNo: input.sourceDocumentNo ?? null,
      sourceLineId: input.sourceLineId ?? null,
      sourceRow: input.sourceRow ?? null,
      sourceCreatedAt: input.sourceCreatedAt ? new Date(input.sourceCreatedAt) : null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    }),
  });
  return { id: row.id, created: true };
}

export async function listMfgMappings(session: SessionRef, partId: string) {
  return prisma.partMfgMapping.findMany({
    where: tenantWhere(session.tenantId, { partId }),
    orderBy: [{ status: "asc" }, { relationType: "asc" }, { evidenceCount: "desc" }],
  });
}

type Outcome = { ok: true } | { ok: false; reason: string };

/**
 * 人工审批(ENGINEERING/MANAGEMENT 由路由层把门):
 * decision=APPROVED 可附带 relationType 升级(如 MAINTAINED→APPROVED/PRIMARY);
 * syncPreferred=true 时经 §23 守卫把映射写回 Part.mpn 缓存。
 */
export async function decideMfgMapping(
  session: SessionRef,
  mappingId: string,
  input: {
    decision: "APPROVED" | "REJECTED";
    relationType?: PartMfgRelationType;
    syncPreferred?: boolean;
  },
): Promise<Outcome> {
  const mapping = await prisma.partMfgMapping.findFirst({
    where: tenantWhere(session.tenantId, { id: mappingId }),
  });
  if (!mapping) return { ok: false, reason: "映射不存在或不属于当前租户" };

  const nextStatus: PartMfgMappingStatus = input.decision;
  const nextRelation = input.relationType ?? mapping.relationType;

  return prisma.$transaction(async (tx) => {
    await tx.partMfgMapping.update({
      where: { id: mapping.id },
      data: {
        status: nextStatus,
        relationType: nextRelation,
        confirmedById: session.userId,
        confirmedAt: new Date(),
      },
    });

    let syncedPreferred = false;
    if (input.syncPreferred) {
      const blocked = whyCannotSyncPreferredMpn({
        status: nextStatus,
        relationType: nextRelation,
        source: mapping.source,
        confirmedById: session.userId,
        identifierMatchMode: mapping.identifierMatchMode,
      });
      if (blocked) return { ok: false as const, reason: blocked };
      await tx.part.update({
        where: { id: mapping.partId },
        data: {
          mpn: mapping.manufacturerPartNo,
          manufacturer: mapping.canonicalManufacturerName ?? mapping.rawManufacturer,
        },
      });
      syncedPreferred = true;
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PART_MFG_MAPPING_DECIDE",
      entityType: "PartMfgMapping",
      entityId: mapping.id,
      before: { status: mapping.status, relationType: mapping.relationType },
      after: {
        status: nextStatus,
        relationType: nextRelation,
        source: mapping.source,
        syncedPreferred,
      },
    });
    return { ok: true as const };
  });
}
