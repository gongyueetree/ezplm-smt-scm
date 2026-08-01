/**
 * 手工建料数据层。
 *
 * 数据主权(整个模块最重要的一条):
 * `Part.origin = EZPLM` 的行是 ezPLM 只读缓存,**本模块的所有写接口必须拒绝改写它们**。
 * 本系统只拥有 LOCAL / IMPORTED / ERP 三种来源的物料。
 *
 * 纪律:
 * - 全部经 tenantWhere / tenantData;每个写操作落 AuditLog;
 * - 疑似重复不静默创建,处置理由入 PartCreationRecord;
 * - AI 提取的属性值 confirmed=false 落库,**不冒充已确认**;
 * - 参考单价只是初始参考,不进任何正式报价计算。
 */
import { Prisma, type PartOrigin, type PartStatus } from "@prisma/client";
import {
  checkDuplicates,
  hasBlockingDuplicate,
  validateForActivation,
  type DuplicateCandidate,
  type FieldIssue,
} from "@/lib/domain/part-create";
import type { ImportPlan, ParsedImportRow } from "@/lib/domain/part-bulk-import";
import { normalizeMpn } from "@/lib/providers/common/mpn";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export interface PartFormInput {
  internalPn?: string | null;
  mpn?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  descriptionEn?: string | null;
  brand?: string | null;
  note?: string | null;
  categoryL1?: string | null;
  categoryL2?: string | null;
  footprint?: string | null;
  lifecycle?: "ACTIVE" | "NRND" | "EOL" | "OBSOLETE" | "UNKNOWN" | null;
  rohs?: boolean | null;
  reach?: boolean | null;
  /** 工艺与供应参数 */
  msl?: string | null;
  packaging?: string | null;
  reelQty?: number | null;
  moq?: number | null;
  spq?: number | null;
  leadTimeDays?: number | null;
  safetyStock?: string | null;
  /** 分类驱动的动态属性:definitionId → {value, source, confidence} */
  attributes?: Record<string, { value: string; source?: string; confidence?: number | null }>;
  /** 默认供应商(引用 Supplier 主数据,不是自由文本) */
  supplierId?: string | null;
  supplierPn?: string | null;
  referencePrice?: string | null;
  currency?: string | null;
  /** 建料来源与重复处置 */
  createdVia?: "MANUAL" | "EZPLM_REFERENCE" | "IMPORT" | "ERP_SYNC";
  duplicateResolution?: "USE_EXISTING" | "MAP_CUSTOMER_PN" | "CREATE_ANYWAY" | null;
  duplicateReason?: string | null;
  aiEvidence?: unknown;
}

/** 疑似重复检查:本地内部料号 / 本地 MPN / 客户料号别名(ezPLM 侧由调用方另行传入) */
export async function runDuplicateCheck(
  session: SessionRef,
  input: { internalPn: string; mpn: string | null; excludePartId?: string | null },
): Promise<DuplicateCandidate[]> {
  const internalPn = input.internalPn.trim();
  const mpnNorm = input.mpn ? normalizeMpn(input.mpn) : null;

  const [byInternal, byMpn, alias] = await Promise.all([
    internalPn
      ? prisma.part.findFirst({
          where: tenantWhere(session.tenantId, {
            internalPn,
            ...(input.excludePartId ? { id: { not: input.excludePartId } } : {}),
          }),
          select: { id: true, internalPn: true, mpn: true, manufacturer: true },
        })
      : null,
    input.mpn
      ? prisma.part.findMany({
          where: tenantWhere(session.tenantId, {
            mpn: { not: null },
            ...(input.excludePartId ? { id: { not: input.excludePartId } } : {}),
          }),
          select: { id: true, internalPn: true, mpn: true, manufacturer: true },
          take: 500,
        })
      : [],
    input.mpn
      ? prisma.customerPartMapping.findMany({
          where: tenantWhere(session.tenantId, { customerPn: input.mpn }),
          select: { partId: true },
          take: 10,
        })
      : [],
  ]);

  // MPN 命中在内存里按**归一后**比,避免大小写/后缀差异漏判
  const mpnHits = (byMpn as { id: string; internalPn: string; mpn: string | null; manufacturer: string | null }[])
    .filter((p) => p.mpn && mpnNorm && normalizeMpn(p.mpn) === mpnNorm)
    .slice(0, 5);

  // 客户料号映射指向 partId(可空:映射建立时物料未必已入库)
  const aliasPartIds = alias.map((a) => a.partId).filter((x): x is string => Boolean(x));
  const aliasParts = aliasPartIds.length
    ? await prisma.part.findMany({
        where: tenantWhere(session.tenantId, { id: { in: aliasPartIds } }),
        select: { id: true, internalPn: true, mpn: true, manufacturer: true },
      })
    : [];

  return checkDuplicates({
    internalPn,
    mpn: input.mpn,
    localByInternalPn: byInternal,
    localByMpn: mpnHits,
    customerPnAlias: aliasParts,
  });
}

function toDecimal(v: string | null | undefined): Prisma.Decimal | null {
  if (v === null || v === undefined || v.trim() === "") return null;
  try {
    return new Prisma.Decimal(v);
  } catch {
    return null;
  }
}

export type CreateOutcome =
  | { ok: true; partId: string; status: PartStatus }
  | { ok: false; code: "validation" | "duplicate" | "forbidden"; message: string; issues?: FieldIssue[]; candidates?: DuplicateCandidate[] };

/**
 * 建料(草稿或正式)。
 *
 * - `status=DRAFT` 只做草稿校验,允许缺字段;
 * - `status=PENDING_REVIEW/ACTIVE` 走完整校验 + 阻断性重复检查;
 * - 疑似(非阻断)重复必须已给出 `duplicateResolution`,否则拒绝 —— **不允许静默创建**。
 */
export async function createPart(
  session: SessionRef,
  input: PartFormInput,
  target: PartStatus,
): Promise<CreateOutcome> {
  const internalPn = (input.internalPn ?? "").trim();
  const mpn = (input.mpn ?? "").trim() || null;

  if (target !== "DRAFT") {
    const issues = validateForActivation({
      internalPn,
      mpn,
      manufacturer: input.manufacturer,
      description: input.description,
      categoryL1: input.categoryL1,
    });
    if (issues.length > 0) {
      return { ok: false, code: "validation", message: "必填项不完整", issues };
    }
  }

  const candidates = internalPn
    ? await runDuplicateCheck(session, { internalPn, mpn })
    : [];

  if (hasBlockingDuplicate(candidates)) {
    return {
      ok: false,
      code: "duplicate",
      message: candidates.find((c) => c.blocking)!.reason,
      candidates,
    };
  }
  // 有疑似重复但没给处置 → 拒绝(静默创建是这套流程最忌讳的事)
  if (candidates.length > 0 && target !== "DRAFT" && !input.duplicateResolution) {
    return {
      ok: false,
      code: "duplicate",
      message: "存在疑似重复物料,请先选择处置方式(使用已有 / 建客户料号映射 / 仍然创建并说明原因)",
      candidates,
    };
  }
  if (input.duplicateResolution === "CREATE_ANYWAY" && !input.duplicateReason?.trim()) {
    return {
      ok: false,
      code: "duplicate",
      message: "选择「仍然创建」时必须填写原因",
      candidates,
    };
  }

  const origin: PartOrigin =
    input.createdVia === "IMPORT" ? "IMPORTED" : input.createdVia === "ERP_SYNC" ? "ERP" : "LOCAL";

  const created = await prisma.$transaction(async (tx) => {
    const part = await tx.part.create({
      data: tenantData(session.tenantId, {
        internalPn: internalPn || `DRAFT-${Date.now()}`,
        mpn,
        manufacturer: input.manufacturer ?? null,
        description: input.description ?? null,
        descriptionEn: input.descriptionEn ?? null,
        brand: input.brand ?? null,
        note: input.note ?? null,
        categoryL1: input.categoryL1 ?? null,
        categoryL2: input.categoryL2 ?? null,
        footprint: input.footprint ?? null,
        lifecycle: input.lifecycle ?? "UNKNOWN",
        rohs: input.rohs ?? null,
        reach: input.reach ?? null,
        origin,
        status: target,
        // 自建料不是任何外部源的缓存:sourcedFrom 记 LOCAL,syncedAt 留空
        sourcedFrom: "LOCAL",
        syncedAt: null,
      }),
    });

    if (
      input.msl ||
      input.packaging ||
      input.reelQty != null ||
      input.moq != null ||
      input.spq != null ||
      input.leadTimeDays != null ||
      input.safetyStock
    ) {
      await tx.partProcessAttr.create({
        data: tenantData(session.tenantId, {
          partId: part.id,
          msl: input.msl ?? null,
          packaging: input.packaging ?? null,
          reelQty: input.reelQty ?? null,
          moq: input.moq ?? null,
          spq: input.spq ?? null,
          leadTimeDays: input.leadTimeDays ?? null,
          safetyStock: toDecimal(input.safetyStock),
          updatedById: session.userId,
        }),
      });
    }

    for (const [definitionId, v] of Object.entries(input.attributes ?? {})) {
      if (!v.value?.trim()) continue;
      await tx.partAttributeValue.create({
        data: tenantData(session.tenantId, {
          partId: part.id,
          definitionId,
          value: v.value,
          source: v.source ?? "MANUAL",
          confidence: v.confidence ?? null,
          // AI 提取的值**不冒充已确认**;人工录入的才算确认
          confirmed: (v.source ?? "MANUAL") === "MANUAL",
          updatedById: session.userId,
        }),
      });
    }

    if (input.supplierId) {
      await tx.partSupplierRef.create({
        data: tenantData(session.tenantId, {
          partId: part.id,
          supplierId: input.supplierId,
          supplierPn: input.supplierPn ?? null,
          referencePrice: toDecimal(input.referencePrice),
          currency: input.currency ?? "CNY",
          isDefault: true,
          createdById: session.userId,
        }),
      });
    }

    await tx.partCreationRecord.create({
      data: tenantData(session.tenantId, {
        partId: part.id,
        createdVia: input.createdVia ?? "MANUAL",
        duplicateCandidates: (candidates as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        duplicateResolution: input.duplicateResolution ?? null,
        duplicateReason: input.duplicateReason ?? null,
        aiEvidence: (input.aiEvidence as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        createdById: session.userId,
      }),
    });

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: target === "DRAFT" ? "PART_DRAFT_SAVE" : "PART_CREATE",
      entityType: "Part",
      entityId: part.id,
      after: {
        internalPn: part.internalPn,
        mpn,
        origin,
        status: target,
        createdVia: input.createdVia ?? "MANUAL",
        duplicateCandidates: candidates.length,
        duplicateResolution: input.duplicateResolution ?? null,
      },
    });

    return part;
  });

  return { ok: true, partId: created.id, status: target };
}

/**
 * 改写守卫:**ezPLM 缓存行禁止本系统改写**。
 * 这是数据主权的落地点,任何编辑/审核/停用接口都要先过这一关。
 */
export async function assertWritablePart(
  session: SessionRef,
  partId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const part = await prisma.part.findFirst({
    where: tenantWhere(session.tenantId, { id: partId }),
    select: { id: true, origin: true, internalPn: true },
  });
  if (!part) return { ok: false, message: "物料不存在或不属于当前租户" };
  if (part.origin === "EZPLM") {
    return {
      ok: false,
      message: `「${part.internalPn}」来自 ezPLM(物料主数据唯一真源),本系统只读 —— 请在 ezPLM 中修改后同步回来`,
    };
  }
  return { ok: true };
}

/** 审核:草稿/待审 → ACTIVE 或 REJECTED */
export async function reviewPart(
  session: SessionRef,
  partId: string,
  decision: "ACTIVE" | "REJECTED",
  note?: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const guard = await assertWritablePart(session, partId);
  if (!guard.ok) return guard;

  if (decision === "ACTIVE") {
    const part = await prisma.part.findFirst({
      where: tenantWhere(session.tenantId, { id: partId }),
      select: { internalPn: true, mpn: true, manufacturer: true, description: true, categoryL1: true },
    });
    const issues = validateForActivation(part ?? {});
    if (issues.length > 0) {
      return { ok: false, message: `必填项不完整:${issues.map((i) => i.message).join("、")}` };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.part.update({ where: { id: partId }, data: { status: decision } });
    await tx.partCreationRecord.updateMany({
      where: tenantWhere(session.tenantId, { partId }),
      data: { reviewedById: session.userId, reviewedAt: new Date(), reviewNote: note ?? null },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: decision === "ACTIVE" ? "PART_REVIEW_APPROVE" : "PART_REVIEW_REJECT",
      entityType: "Part",
      entityId: partId,
      after: { decision, note: note ?? null },
    });
  });
  return { ok: true };
}

/** 取库内已有的内部料号与 MPN 集合(批量导入的重复判定输入) */
export async function loadExistingKeys(
  session: SessionRef,
): Promise<{ internalPns: Set<string>; mpns: Set<string> }> {
  const rows = await prisma.part.findMany({
    where: tenantWhere(session.tenantId),
    select: { internalPn: true, mpn: true },
    take: 20000,
  });
  return {
    internalPns: new Set(rows.map((r) => r.internalPn)),
    mpns: new Set(rows.filter((r) => r.mpn).map((r) => r.mpn!.toUpperCase())),
  };
}

/**
 * 批量创建物料(origin=IMPORTED)。
 *
 * 纪律:
 * - **阻断行一律不建**(内部料号重复);
 * - **疑似重复默认不建**,除非调用方显式 includeSuspected —— 与手工建料同一套口径:
 *   不静默放行,也不静默丢弃;
 * - 单行失败不拖垮整批。
 */
export async function bulkCreateParts(
  session: SessionRef,
  rows: readonly ParsedImportRow[],
  plan: ImportPlan,
  includeSuspected: boolean,
): Promise<{ count: number; skipped: number; note: string | null }> {
  const outcomeByRow = new Map(plan.rows.map((p) => [p.rowNo, p.outcome]));
  const targets = rows.filter((r) => {
    const o = outcomeByRow.get(r.rowNo);
    if (o === "BLOCKED_DUPLICATE") return false;
    if (o === "SUSPECTED_DUPLICATE") return includeSuspected;
    return true;
  });

  let count = 0;
  await prisma.$transaction(async (tx) => {
    for (const r of targets) {
      try {
        const part = await tx.part.create({
          data: tenantData(session.tenantId, {
            internalPn: r.internalPn,
            mpn: r.mpn,
            manufacturer: r.manufacturer,
            description: r.description,
            descriptionEn: r.descriptionEn,
            brand: r.brand,
            note: r.note,
            categoryL1: r.categoryL1,
            categoryL2: r.categoryL2,
            footprint: r.footprint,
            origin: "IMPORTED",
            status: "ACTIVE",
            sourcedFrom: "LOCAL",
          }),
        });
        if (r.msl || r.packaging || r.reelQty != null || r.moq != null || r.spq != null || r.leadTimeDays != null) {
          await tx.partProcessAttr.create({
            data: tenantData(session.tenantId, {
              partId: part.id,
              msl: r.msl,
              packaging: r.packaging,
              reelQty: r.reelQty,
              moq: r.moq,
              spq: r.spq,
              leadTimeDays: r.leadTimeDays,
              updatedById: session.userId,
            }),
          });
        }
        await tx.partCreationRecord.create({
          data: tenantData(session.tenantId, {
            partId: part.id,
            createdVia: "IMPORT",
            duplicateResolution: outcomeByRow.get(r.rowNo) === "SUSPECTED_DUPLICATE" ? "CREATE_ANYWAY" : null,
            duplicateReason:
              outcomeByRow.get(r.rowNo) === "SUSPECTED_DUPLICATE"
                ? "批量导入时人工确认「同 MPN 仍然创建」"
                : null,
            createdById: session.userId,
          }),
        });
        count += 1;
      } catch {
        // 单行失败不影响整批
      }
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PART_BULK_IMPORT",
      entityType: "Part",
      entityId: `bulk:${count}`,
      after: { created: count, blocked: plan.blocked, suspected: plan.suspected, includeSuspected },
    });
  });

  const skipped = rows.length - count;
  return {
    count,
    skipped,
    note:
      plan.blocked > 0 || (plan.suspected > 0 && !includeSuspected)
        ? `已跳过 ${plan.blocked} 行阻断重复${
            !includeSuspected && plan.suspected > 0 ? `、${plan.suspected} 行疑似重复(需人工确认后才建)` : ""
          }`
        : null,
  };
}

/** 按分类取动态属性定义(通用项 + 该分类专属项) */
export async function loadAttributeDefinitions(
  session: SessionRef,
  categoryL1: string | null,
  categoryL2: string | null,
) {
  const rows = await prisma.partAttributeDefinition.findMany({
    where: tenantWhere(session.tenantId, {
      OR: [
        { categoryL1: null },
        {
          categoryL1,
          OR: [{ categoryL2: null }, { categoryL2 }],
        },
      ],
    }),
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return rows.map((d) => ({
    id: d.id,
    key: d.key,
    label: d.label,
    type: d.type,
    unit: d.unit,
    required: d.required,
    options: d.options,
    validation: d.validation,
    categoryL1: d.categoryL1,
    categoryL2: d.categoryL2,
  }));
}
