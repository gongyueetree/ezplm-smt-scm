/**
 * F2:ECN-Lite 取数与状态机执行。
 * 判定全在 lib/domain/ecn.ts;这里只做取数、条件更新与审计。
 *
 * - 每次状态动作写 AuditLog;VOIDED 可查可溯,无物理删除路径;
 * - Release 冻结快照(头+行+审批史),此后导出/展示以快照为准;
 * - Apply to BOM:仅 RELEASED;生成**新 BOMVersion(ecnId 回链)**,原版本不动,
 *   逐行替换结果如实回报(命中/未命中)。
 */
import type { Prisma } from "@prisma/client";
import { normalizeMpnKey } from "@/modules/parts/domain/part-identity";
import {
  buildEcnCode,
  canApplyToBom,
  canClose,
  canCustomerConfirm,
  canDecideStage,
  canReject,
  canRelease,
  canSubmit,
  canVoid,
  currentStageInList,
  isFrozen,
  parseWorkflowSnapshot,
  resolveApprovalStages,
  statusAfterFinalApproval,
  type EcnStageValue,
  type EcnStatusValue,
} from "@/lib/domain/ecn";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { getTenantSettings } from "@/lib/server/tenant-settings";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

type Outcome<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

async function loadEcn(session: SessionRef, ecnId: string) {
  return prisma.ecn.findFirst({
    where: tenantWhere(session.tenantId, { id: ecnId }),
    include: {
      changeLines: { orderBy: { lineNo: "asc" } },
      approvals: { orderBy: { decidedAt: "asc" } },
      customerNotices: true,
    },
  });
}

/** R3-5:当前租户配置解析出的审批链(仅用于**提交时冻结**与草稿预览;在途单读快照) */
export async function stageConfig(tenantId: string): Promise<EcnStageValue[]> {
  const { settings } = await getTenantSettings(tenantId);
  return resolveApprovalStages(settings.ecnApprovalStages, settings.ecnReviewStages);
}

export async function createEcn(
  session: SessionRef,
  input: {
    title: string;
    type: string;
    priority: string;
    customerId?: string | null;
    productName?: string | null;
    reason?: string | null;
    dueDate?: string | null;
  },
): Promise<Outcome<{ ecnId: string; code: string }>> {
  // 编号:当日序号递增;并发撞唯一索引时重试(最多 3 次)
  for (let attempt = 0; attempt < 3; attempt++) {
    const today = new Date();
    const prefix = `ECN-${today.toISOString().slice(0, 10).replaceAll("-", "")}`;
    const countToday = await prisma.ecn.count({
      where: tenantWhere(session.tenantId, { code: { startsWith: prefix } }),
    });
    const code = buildEcnCode(today, countToday + 1 + attempt);
    try {
      const ecn = await prisma.ecn.create({
        data: tenantData(session.tenantId, {
          code,
          title: input.title,
          type: input.type as never,
          priority: input.priority as never,
          customerId: input.customerId ?? null,
          productName: input.productName ?? null,
          reason: input.reason ?? null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          createdById: session.userId,
        }),
      });
      await writeAudit(prisma, {
        tenantId: session.tenantId,
        userId: session.userId,
        action: "ECN_CREATE",
        entityType: "Ecn",
        entityId: ecn.id,
        after: { code, title: input.title, type: input.type },
      });
      return { ok: true, ecnId: ecn.id, code };
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  return { ok: false, reason: "编号生成冲突,请重试" };
}

export async function updateEcnHeader(
  session: SessionRef,
  ecnId: string,
  patch: Partial<{
    title: string;
    type: string;
    priority: string;
    customerId: string | null;
    productName: string | null;
    reason: string | null;
    dueDate: string | null;
    effectiveStrategy: string | null;
    effectiveAt: string | null;
  }>,
): Promise<Outcome> {
  const ecn = await loadEcn(session, ecnId);
  if (!ecn) return { ok: false, reason: "ECN 不存在或不属于当前租户" };
  if (isFrozen(ecn.status as EcnStatusValue)) {
    return { ok: false, reason: "评审开始后头信息冻结 —— 需修改请先退回草稿" };
  }
  await prisma.ecn.update({
    where: { id: ecn.id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.type !== undefined ? { type: patch.type as never } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority as never } : {}),
      ...(patch.customerId !== undefined ? { customerId: patch.customerId } : {}),
      ...(patch.productName !== undefined ? { productName: patch.productName } : {}),
      ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ? new Date(patch.dueDate) : null } : {}),
      ...(patch.effectiveStrategy !== undefined
        ? { effectiveStrategy: (patch.effectiveStrategy || null) as never }
        : {}),
      ...(patch.effectiveAt !== undefined
        ? { effectiveAt: patch.effectiveAt ? new Date(patch.effectiveAt) : null }
        : {}),
    },
  });
  return { ok: true };
}

export async function addEcnLines(
  session: SessionRef,
  ecnId: string,
  lines: {
    oldInternalPn: string | null;
    oldMpn: string | null;
    newInternalPn: string | null;
    newMpn: string | null;
    qtyImpact: string | null;
    reason: string | null;
    engineeringNote: string | null;
  }[],
): Promise<Outcome<{ added: number }>> {
  const ecn = await loadEcn(session, ecnId);
  if (!ecn) return { ok: false, reason: "ECN 不存在或不属于当前租户" };
  if (isFrozen(ecn.status as EcnStatusValue)) {
    return { ok: false, reason: "评审开始后变更行冻结 —— 需修改请先退回草稿" };
  }
  const startNo = (ecn.changeLines.at(-1)?.lineNo ?? 0) + 1;
  await prisma.ecnChangeLine.createMany({
    data: lines.map((l, i) =>
      tenantData(session.tenantId, {
        ecnId: ecn.id,
        lineNo: startNo + i,
        oldInternalPn: l.oldInternalPn,
        oldMpn: l.oldMpn,
        newInternalPn: l.newInternalPn,
        newMpn: l.newMpn,
        qtyImpact: l.qtyImpact,
        reason: l.reason,
        engineeringNote: l.engineeringNote,
      }),
    ),
  });
  await writeAudit(prisma, {
    tenantId: session.tenantId,
    userId: session.userId,
    action: "ECN_LINES_ADD",
    entityType: "Ecn",
    entityId: ecn.id,
    after: { added: lines.length },
  });
  return { ok: true, added: lines.length };
}

export async function removeEcnLine(session: SessionRef, ecnId: string, lineId: string): Promise<Outcome> {
  const ecn = await loadEcn(session, ecnId);
  if (!ecn) return { ok: false, reason: "ECN 不存在或不属于当前租户" };
  if (isFrozen(ecn.status as EcnStatusValue)) return { ok: false, reason: "评审开始后变更行冻结" };
  const deleted = await prisma.ecnChangeLine.deleteMany({
    where: tenantWhere(session.tenantId, { id: lineId, ecnId: ecn.id }),
  });
  if (deleted.count === 0) return { ok: false, reason: "变更行不存在" };
  return { ok: true };
}

// ---- 状态动作 ----

async function transition(
  session: SessionRef,
  ecnId: string,
  from: EcnStatusValue[],
  to: EcnStatusValue,
  action: string,
  extra: Prisma.EcnUpdateInput = {},
  auditAfter: Record<string, unknown> = {},
): Promise<Outcome> {
  // 条件更新:并发下只有一个动作成立
  const updated = await prisma.ecn.updateMany({
    where: { id: ecnId, tenantId: session.tenantId, status: { in: from as never[] } },
    data: { status: to as never, ...(extra as object) },
  });
  if (updated.count === 0) return { ok: false, reason: "状态已被其他操作改变,请刷新后重试" };
  await writeAudit(prisma, {
    tenantId: session.tenantId,
    userId: session.userId,
    action,
    entityType: "Ecn",
    entityId: ecnId,
    after: { to, ...auditAfter },
  });
  return { ok: true };
}

export async function submitEcn(session: SessionRef, ecnId: string): Promise<Outcome> {
  const ecn = await loadEcn(session, ecnId);
  if (!ecn) return { ok: false, reason: "ECN 不存在或不属于当前租户" };
  const check = canSubmit(ecn.status as EcnStatusValue, ecn.changeLines.length);
  if (!check.ok) return { ok: false, reason: check.reason! };
  // R3-5:提交那一刻冻结审批链 —— 评审期间改配置不影响本单;退回重提会重新冻结
  const stages = await stageConfig(session.tenantId);
  return transition(session, ecnId, ["DRAFT"], "REVIEW", "ECN_SUBMIT", {
    submittedAt: new Date(),
    workflowSnapshot: { stages, frozenAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
  });
}

export async function decideStage(
  session: SessionRef,
  ecnId: string,
  input: { decision: "APPROVED" | "REJECTED"; comment: string | null },
): Promise<Outcome<{ status: EcnStatusValue }>> {
  const ecn = await loadEcn(session, ecnId);
  if (!ecn) return { ok: false, reason: "ECN 不存在或不属于当前租户" };
  if (ecn.status !== "REVIEW") return { ok: false, reason: "只有评审中的 ECN 可审批" };

  // R3-5:审批链只看提交时冻结的快照;快照缺失(冻结上线前的在途单)回落实时配置并审计标注
  const frozen = parseWorkflowSnapshot(ecn.workflowSnapshot);
  const stages = frozen?.stages ?? (await stageConfig(session.tenantId));
  // 本轮评审(最近一次提交后)已通过的阶段
  const approvedStages = new Set<EcnStageValue>(
    ecn.approvals
      .filter((a) => a.decision === "APPROVED" && ecn.submittedAt && a.decidedAt >= ecn.submittedAt)
      .map((a) => a.stage as EcnStageValue),
  );
  const stage = currentStageInList(stages, approvedStages);
  if (!stage) return { ok: false, reason: "所有阶段已通过" };
  if (!canDecideStage(stage, session.roles)) {
    return { ok: false, reason: `当前阶段为「${stage}」,您无权审批此 ECN` };
  }

  if (input.decision === "REJECTED") {
    const check = canReject("REVIEW", input.comment);
    if (!check.ok) return { ok: false, reason: check.reason! };
    await prisma.ecnApproval.create({
      data: tenantData(session.tenantId, {
        ecnId: ecn.id,
        stage,
        decision: "REJECTED",
        comment: input.comment,
        decidedById: session.userId,
      }),
    });
    const t = await transition(session, ecnId, ["REVIEW"], "DRAFT", "ECN_STAGE_REJECT", {}, { stage, comment: input.comment });
    return t.ok ? { ok: true, status: "DRAFT" } : t;
  }

  await prisma.ecnApproval.create({
    data: tenantData(session.tenantId, {
      ecnId: ecn.id,
      stage,
      decision: "APPROVED",
      comment: input.comment,
      decidedById: session.userId,
    }),
  });
  approvedStages.add(stage);
  const next = currentStageInList(stages, approvedStages);
  if (next) {
    await writeAudit(prisma, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "ECN_STAGE_APPROVE",
      entityType: "Ecn",
      entityId: ecnId,
      after: { stage, nextStage: next, ...(frozen ? {} : { workflowFallback: "快照缺失,按提交后当前配置执行" }) },
    });
    return { ok: true, status: "REVIEW" };
  }
  // 末段通过:是否需客户确认(flag 开 且 存在 required 告知)
  const { settings } = await getTenantSettings(session.tenantId);
  const needsCustomer =
    settings.featureFlags["ecn.customerNotice"] && ecn.customerNotices.some((n) => n.required);
  const target = statusAfterFinalApproval(needsCustomer);
  const t = await transition(session, ecnId, ["REVIEW"], target, "ECN_STAGE_APPROVE", {}, { stage, final: true });
  return t.ok ? { ok: true, status: target } : t;
}

export async function confirmCustomer(session: SessionRef, ecnId: string, note: string | null): Promise<Outcome> {
  const ecn = await loadEcn(session, ecnId);
  if (!ecn) return { ok: false, reason: "ECN 不存在或不属于当前租户" };
  const check = canCustomerConfirm(ecn.status as EcnStatusValue);
  if (!check.ok) return { ok: false, reason: check.reason! };
  return transition(session, ecnId, ["CUSTOMER_CONFIRM"], "APPROVED", "ECN_CUSTOMER_CONFIRMED", {}, { note });
}

export async function releaseEcn(session: SessionRef, ecnId: string): Promise<Outcome> {
  if (!session.roles.includes("MANAGEMENT")) return { ok: false, reason: "仅管理层可发布 ECN" };
  const ecn = await loadEcn(session, ecnId);
  if (!ecn) return { ok: false, reason: "ECN 不存在或不属于当前租户" };
  const check = canRelease(ecn.status as EcnStatusValue);
  if (!check.ok) return { ok: false, reason: check.reason! };

  // 冻结快照:头 + 行 + 审批史(此后导出以快照为准)
  const snapshot = {
    code: ecn.code,
    title: ecn.title,
    type: ecn.type,
    priority: ecn.priority,
    customerId: ecn.customerId,
    productName: ecn.productName,
    reason: ecn.reason,
    effectiveStrategy: ecn.effectiveStrategy,
    effectiveAt: ecn.effectiveAt?.toISOString() ?? null,
    lines: ecn.changeLines.map((l) => ({
      lineNo: l.lineNo,
      oldInternalPn: l.oldInternalPn,
      oldMpn: l.oldMpn,
      newInternalPn: l.newInternalPn,
      newMpn: l.newMpn,
      qtyImpact: l.qtyImpact?.toString() ?? null,
      reason: l.reason,
      engineeringNote: l.engineeringNote,
      procurementNote: l.procurementNote,
    })),
    approvals: ecn.approvals.map((a) => ({
      stage: a.stage,
      decision: a.decision,
      comment: a.comment,
      decidedById: a.decidedById,
      decidedAt: a.decidedAt.toISOString(),
    })),
    // R3-5:发布快照回答"当时的审批链是什么"
    workflow: parseWorkflowSnapshot(ecn.workflowSnapshot),
    releasedBy: session.userId,
    releasedAt: new Date().toISOString(),
  };
  return transition(
    session,
    ecnId,
    ["APPROVED"],
    "RELEASED",
    "ECN_RELEASE",
    {
      releasedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      releasedAt: new Date(),
      releasedById: session.userId,
    },
    { lineCount: ecn.changeLines.length },
  );
}

export async function closeEcn(session: SessionRef, ecnId: string): Promise<Outcome> {
  const ecn = await loadEcn(session, ecnId);
  if (!ecn) return { ok: false, reason: "ECN 不存在或不属于当前租户" };
  const check = canClose(ecn.status as EcnStatusValue);
  if (!check.ok) return { ok: false, reason: check.reason! };
  return transition(session, ecnId, ["RELEASED"], "CLOSED", "ECN_CLOSE");
}

export async function voidEcn(session: SessionRef, ecnId: string, reason: string): Promise<Outcome> {
  const ecn = await loadEcn(session, ecnId);
  if (!ecn) return { ok: false, reason: "ECN 不存在或不属于当前租户" };
  const isCreatorDraft = ecn.status === "DRAFT" && ecn.createdById === session.userId;
  if (!session.roles.includes("MANAGEMENT") && !isCreatorDraft) {
    return { ok: false, reason: "仅管理层可作废(发起人仅限草稿态)" };
  }
  const check = canVoid(ecn.status as EcnStatusValue, reason);
  if (!check.ok) return { ok: false, reason: check.reason! };
  return transition(
    session,
    ecnId,
    ["DRAFT", "REVIEW", "CUSTOMER_CONFIRM", "APPROVED"],
    "VOIDED",
    "ECN_VOID",
    { voidReason: reason, voidedAt: new Date(), voidedById: session.userId },
    { reason },
  );
}

// ---- Apply to BOM(不是状态转移;仅 RELEASED;二次确认在路由层校验 confirm 字段) ----

export interface ApplyResult {
  newVersionId: string;
  newVersionNo: number;
  replaced: { lineNo: number; from: string; to: string }[];
  unmatched: { changeLineNo: number; oldRef: string }[];
}

export async function applyEcnToBom(
  session: SessionRef,
  ecnId: string,
  bomId: string,
): Promise<Outcome<{ result: ApplyResult }>> {
  const ecn = await loadEcn(session, ecnId);
  if (!ecn) return { ok: false, reason: "ECN 不存在或不属于当前租户" };
  const check = canApplyToBom(ecn.status as EcnStatusValue);
  if (!check.ok) return { ok: false, reason: check.reason! };

  const latest = await prisma.bOMVersion.findFirst({
    where: tenantWhere(session.tenantId, { bomId }),
    orderBy: { versionNo: "desc" },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!latest) return { ok: false, reason: "BOM 不存在或没有版本" };

  const norm = (v: string | null | undefined) => normalizeMpnKey(v);

  const result: ApplyResult = { newVersionId: "", newVersionNo: 0, replaced: [], unmatched: [] };

  await prisma.$transaction(async (tx) => {
    const version = await tx.bOMVersion.create({
      data: tenantData(session.tenantId, {
        bomId,
        versionNo: latest.versionNo + 1,
        note: `由 ECN ${ecn.code} Apply to BOM 生成(基于 V${latest.versionNo})`,
        ecnId: ecn.id,
        createdById: session.userId,
      }),
    });
    result.newVersionId = version.id;
    result.newVersionNo = latest.versionNo + 1;

    const matchedChangeLines = new Set<number>();
    const newLines = latest.lines.map((l) => {
      const hit = ecn.changeLines.find(
        (c) =>
          (c.oldMpn && norm(c.oldMpn) === norm(l.mpn)) ||
          (c.oldInternalPn && norm(c.oldInternalPn) === norm(l.internalPn)),
      );
      if (hit && (hit.newMpn || hit.newInternalPn)) {
        matchedChangeLines.add(hit.lineNo);
        result.replaced.push({
          lineNo: l.lineNo,
          from: l.mpn ?? l.internalPn ?? "?",
          to: hit.newMpn ?? hit.newInternalPn ?? "?",
        });
        return {
          ...l,
          mpn: hit.newMpn ?? l.mpn,
          internalPn: hit.newInternalPn ?? null,
          internalPartId: null, // 新料需重新匹配主数据,不沿用旧料 id
          internalPnSource: null,
          internalPnNote: `ECN ${ecn.code} 替换(原:${l.mpn ?? l.internalPn ?? "?"})`,
          mpnSource: "ecn",
        };
      }
      return l;
    });

    await tx.bOMLine.createMany({
      data: newLines.map((l) =>
        tenantData(session.tenantId, {
          bomVersionId: version.id,
          lineNo: l.lineNo,
          refDes: l.refDes,
          qty: l.qty,
          customerPn: l.customerPn,
          mpn: l.mpn,
          manufacturer: l.manufacturer,
          description: l.description,
          footprint: l.footprint,
          packageCode: l.packageCode,
          mpnSource: l.mpnSource,
          internalPartId: l.internalPartId,
          internalPn: l.internalPn,
          internalPnSource: l.internalPnSource,
          internalPnNote: l.internalPnNote,
        }),
      ),
    });

    for (const c of ecn.changeLines) {
      if (!matchedChangeLines.has(c.lineNo)) {
        result.unmatched.push({
          changeLineNo: c.lineNo,
          oldRef: c.oldMpn ?? c.oldInternalPn ?? "?",
        });
      }
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "ECN_APPLY_TO_BOM",
      entityType: "Ecn",
      entityId: ecn.id,
      after: {
        bomId,
        newVersionId: version.id,
        newVersionNo: result.newVersionNo,
        replaced: result.replaced.length,
        unmatched: result.unmatched.length,
      },
    });
  });

  return { ok: true, result };
}
