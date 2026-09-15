/**
 * R4-3(§19/§20):Manufacturer Resolution Review —— 装载解析上下文、
 * 批量出建议、人工批准落 TENANT 别名并回写 PartMfgMapping。
 *
 * 纪律:
 * - 只有人工批准才创建永久别名(自动系统只能提建议,§20);
 * - 批准动作 AuditLog(raw→canonical、来源、置信度);
 * - MPN 证据用**本地 ezPLM 缓存 Part**(origin=EZPLM)—— 不打线上 API,
 *   16K 规模逐行解析不允许 N 次外呼(§32);
 * - Tenant 别名严格 tenant scoped,绝不写成 GLOBAL(§14)。
 */
import { manufacturerKeyOf, mfgPartNoKey } from "@/lib/domain/part-mfg";
import {
  resolveManufacturer,
  type AliasLite,
  type CanonicalManufacturerLite,
  type ManufacturerResolution,
  type ResolverContext,
} from "@/lib/integration/erp/normalization/manufacturer-resolver";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantWhere } from "@/lib/server/tenant-scope";

/** 装载解析上下文(每次批处理一次性装载,逐行零查询) */
export async function loadResolverContext(tenantId: string): Promise<ResolverContext> {
  const [aliases, canonicals, ezplmParts] = await Promise.all([
    prisma.manufacturerAlias.findMany({
      where: { status: "APPROVED", tenantId: { in: ["", tenantId] } },
      include: { canonicalRef: { select: { id: true, canonicalName: true } } },
    }),
    prisma.canonicalManufacturerRef.findMany({
      select: { id: true, canonicalName: true, normalizedName: true },
    }),
    // 本地 ezPLM 缓存:exact MPN → 厂商(多义 MPN 剔除 —— 只有唯一命中才算证据)
    prisma.part.findMany({
      where: tenantWhere(tenantId, { origin: "EZPLM" as const, mpn: { not: null } }),
      select: { mpn: true, manufacturer: true },
    }),
  ]);

  const tenantAliases = new Map<string, AliasLite>();
  const globalAliases = new Map<string, AliasLite>();
  for (const a of aliases) {
    const lite: AliasLite = {
      normalizedAlias: a.normalizedAlias,
      canonicalRefId: a.canonicalRefId,
      canonicalName: a.canonicalRef.canonicalName,
    };
    (a.tenantId === "" ? globalAliases : tenantAliases).set(a.normalizedAlias, lite);
  }

  const canonicalByNorm = new Map<string, CanonicalManufacturerLite>(
    canonicals.map((c) => [c.normalizedName, c]),
  );

  const mpnToMfg = new Map<string, string | null>(); // null = 多义,不可作证据
  for (const p of ezplmParts) {
    const k = mfgPartNoKey(p.mpn);
    if (!k || !p.manufacturer) continue;
    if (!mpnToMfg.has(k)) mpnToMfg.set(k, p.manufacturer);
    else if (mpnToMfg.get(k) !== p.manufacturer) mpnToMfg.set(k, null);
  }

  return {
    tenantAliases,
    globalAliases,
    canonicalByNorm,
    mpnEvidence: (normalizedMpn) => {
      const m = mpnToMfg.get(normalizedMpn);
      return m ? { manufacturerName: m } : null;
    },
  };
}

export interface ReviewRow {
  rawManufacturer: string;
  mappingCount: number;
  sampleMpnKey: string | null;
  suggestion: ManufacturerResolution;
}

/**
 * 生成 Review 清单:未解析映射的 unique raw MFG → 建议。
 * 组内带一个样本 MPN 供 MPN 证据通道(§17)。
 */
export async function buildManufacturerReview(session: SessionRef): Promise<ReviewRow[]> {
  const ctx = await loadResolverContext(session.tenantId);
  const groups = await prisma.partMfgMapping.groupBy({
    by: ["rawManufacturer"],
    where: tenantWhere(session.tenantId, {
      manufacturerResolutionStatus: "UNRESOLVED" as const,
      identifierKind: "COMPONENT_MPN" as const,
      rawManufacturer: { not: null },
    }),
    _count: { _all: true },
    _max: { manufacturerPartNoKey: true },
  });
  const rows: ReviewRow[] = [];
  for (const g of groups) {
    if (!g.rawManufacturer) continue;
    rows.push({
      rawManufacturer: g.rawManufacturer,
      mappingCount: g._count._all,
      sampleMpnKey: g._max.manufacturerPartNoKey,
      suggestion: resolveManufacturer(
        { rawManufacturer: g.rawManufacturer, mpn: g._max.manufacturerPartNoKey, materialKind: "ELECTRONIC_COMPONENT" },
        ctx,
      ),
    });
  }
  rows.sort((a, b) => b.suggestion.confidence - a.suggestion.confidence || b.mappingCount - a.mappingCount);
  return rows;
}

type Outcome = { ok: true; updatedMappings: number } | { ok: false; reason: string };

/**
 * 人工批准:rawName → canonicalRefId。
 * 落 TENANT 别名(APPROVED)+ 回写该 raw 名下全部 COMPONENT_MPN 映射的
 * canonicalManufacturer* 与 resolutionStatus=RESOLVED。
 */
export async function approveManufacturerAlias(
  session: SessionRef,
  input: { rawName: string; canonicalRefId: string; confidence?: number },
): Promise<Outcome> {
  const canonical = await prisma.canonicalManufacturerRef.findUnique({
    where: { id: input.canonicalRefId },
  });
  if (!canonical) return { ok: false, reason: "标准制造商不存在" };
  const normalizedAlias = manufacturerKeyOf(input.rawName);
  if (!normalizedAlias) return { ok: false, reason: "原始厂商名为空/垃圾占位,不可建别名" };

  return prisma.$transaction(async (tx) => {
    await tx.manufacturerAlias.upsert({
      where: { tenantId_normalizedAlias: { tenantId: session.tenantId, normalizedAlias } },
      update: {
        canonicalRefId: canonical.id,
        status: "APPROVED",
        confirmedById: session.userId,
        confirmedAt: new Date(),
        evidenceCount: { increment: 1 },
      },
      create: {
        tenantId: session.tenantId,
        rawName: input.rawName,
        normalizedAlias,
        canonicalRefId: canonical.id,
        scope: "TENANT",
        source: "MANUAL",
        status: "APPROVED",
        confidence: input.confidence ?? 1.0,
        confirmedById: session.userId,
        confirmedAt: new Date(),
      },
    });
    const updated = await tx.partMfgMapping.updateMany({
      where: tenantWhere(session.tenantId, {
        identifierKind: "COMPONENT_MPN" as const,
        rawManufacturer: input.rawName,
      }),
      data: {
        canonicalManufacturerId: canonical.id,
        canonicalManufacturerName: canonical.canonicalName,
        manufacturerResolutionStatus: "RESOLVED",
        manufacturerResolutionConfidence: input.confidence ?? 1.0,
      },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "MANUFACTURER_ALIAS_APPROVE",
      entityType: "ManufacturerAlias",
      entityId: normalizedAlias,
      after: {
        rawName: input.rawName,
        canonical: canonical.canonicalName,
        scope: "TENANT",
        updatedMappings: updated.count,
        confidence: input.confidence ?? 1.0,
      },
    });
    return { ok: true as const, updatedMappings: updated.count };
  });
}

/** 人工拒绝:该 raw 名下映射标 UNRESOLVED 保持,可选建 REJECTED 别名挡住再次建议 */
export async function rejectManufacturerSuggestion(
  session: SessionRef,
  input: { rawName: string },
): Promise<{ ok: true }> {
  const normalizedAlias = manufacturerKeyOf(input.rawName);
  await prisma.$transaction(async (tx) => {
    if (normalizedAlias) {
      const anyCanonical = await tx.canonicalManufacturerRef.findFirst({ select: { id: true } });
      if (anyCanonical) {
        await tx.manufacturerAlias.upsert({
          where: { tenantId_normalizedAlias: { tenantId: session.tenantId, normalizedAlias } },
          update: { status: "REJECTED", confirmedById: session.userId, confirmedAt: new Date() },
          create: {
            tenantId: session.tenantId,
            rawName: input.rawName,
            normalizedAlias,
            canonicalRefId: anyCanonical.id, // 占位引用;REJECTED 状态不参与解析
            scope: "TENANT",
            source: "MANUAL",
            status: "REJECTED",
            confirmedById: session.userId,
            confirmedAt: new Date(),
          },
        });
      }
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "MANUFACTURER_ALIAS_REJECT",
      entityType: "ManufacturerAlias",
      entityId: normalizedAlias || input.rawName,
      after: { rawName: input.rawName },
    });
  });
  return { ok: true };
}
