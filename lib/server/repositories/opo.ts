/**
 * OPO 数据访问(SPEC §14)。
 * 只负责取行与落回复/催办日志;**所有 KPI 与表格一律由 lib/domain/opo.ts 派生**,
 * 本层不缓存、不落任何计数字段。
 */
import type { Prisma } from "@prisma/client";
import {
  collectReminderCandidates,
  deriveAnomalyRows,
  deriveDiffRows,
  deriveNoReplyLines,
  deriveOpoKpi,
  type OpoLineView,
} from "@/lib/domain/opo";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { emptyScopeNotice, type ResolvedScope } from "@/lib/domain/data-scope";
import { scopeFor, scopedWhere } from "@/lib/server/data-scope";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { SessionRef } from "./rfq";

/** 取行 + 最新回复,转成领域视图 */
/**
 * 取在途行。
 *
 * ⚠️ PR-G 生产加固:本函数原先只做 tenantWhere,**没有供应商行级过滤**,
 * 而 /suppliers/opo 对 SUPPLIER 角色开放 ——
 * 供应商登录后能看到**所有供应商**的 PO 行(对手的料号、数量、单价、交期)。
 * 演示数据里恰好只有一家供应商,所以一直没暴露。
 *
 * 现在统一走 data-scope 策略;内部角色仍是全租户,供应商只见自己的。
 */
export async function loadOpoLines(
  tenantId: string,
  scope?: ResolvedScope,
): Promise<OpoLineView[]> {
  const rows = await prisma.oPOLine.findMany({
    where: scope
      ? scopedWhere(tenantId, scope, { supplierField: "supplierId" })
      : tenantWhere(tenantId),
    orderBy: [{ poNo: "asc" }, { lineNo: "asc" }],
    include: { replies: { orderBy: { replyAt: "desc" }, take: 1 } },
    take: 2000,
  });

  return rows.map((r) => ({
    id: r.id,
    poNo: r.poNo,
    lineNo: r.lineNo,
    supplierId: r.supplierId,
    mpn: r.mpn,
    qtyOrdered: Number(r.qtyOrdered),
    qtyOpen: Number(r.qtyOpen),
    promiseDate: r.promiseDate?.toISOString() ?? null,
    needDate: r.needDate?.toISOString() ?? null,
    latestReply: r.replies[0]
      ? {
          replyEta: r.replies[0].replyEta?.toISOString() ?? null,
          replyQty: r.replies[0].replyQty === null ? null : Number(r.replies[0].replyQty),
          replyNote: r.replies[0].replyNote,
          replyAt: r.replies[0].replyAt.toISOString(),
          replySource: r.replies[0].replySource,
        }
      : null,
  }));
}

/**
 * 一次取全:KPI / 未回复 / 差异 / 异常 —— 全部来自同一份 lines。
 *
 * ⚠️ PR-G:必须传 session 以解析数据范围。
 * 原签名只收 tenantId,导致供应商登录后看到全部供应商的在途行。
 */
export async function getOpoDashboard(session: SessionRef, now: string) {
  const scope = await scopeFor(session, "OPO_LINE");
  const lines = await loadOpoLines(session.tenantId, scope);
  return {
    lines,
    kpi: deriveOpoKpi(lines, now),
    noReply: deriveNoReplyLines(lines),
    diffs: deriveDiffRows(lines),
    anomalies: deriveAnomalyRows(lines, now),
    // 受限视图必须显式告知 —— 看不到的部分不代表不存在
    scopeNotice: emptyScopeNotice(scope),
    scopeKind: scope.kind,
  };
}

export interface RecordReplyInput {
  opoLineId: string;
  replyEta: string | null;
  replyQty: number | null;
  replyNote: string | null;
  replySource: "EMAIL" | "PORTAL" | "EXCEL" | "PHONE" | "MANUAL";
  contactId?: string | null;
}

/** 记录供应商回复(五字段齐备) */
export async function recordOpoReply(session: SessionRef, input: RecordReplyInput) {
  const line = await prisma.oPOLine.findFirst({
    where: tenantWhere(session.tenantId, { id: input.opoLineId }),
    select: { id: true, poNo: true, lineNo: true },
  });
  if (!line) return null;

  return prisma.$transaction(async (tx) => {
    const reply = await tx.oPOReply.create({
      data: tenantData(session.tenantId, {
        opoLineId: input.opoLineId,
        replyEta: input.replyEta ? new Date(input.replyEta) : null,
        replyQty: input.replyQty,
        replyNote: input.replyNote,
        replyAt: new Date(),
        replySource: input.replySource,
        contactId: input.contactId ?? null,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "OPO_REPLY_RECORD",
      entityType: "OPOReply",
      entityId: reply.id,
      after: {
        poNo: line.poNo,
        lineNo: line.lineNo,
        replyEta: input.replyEta,
        replyQty: input.replyQty,
        replySource: input.replySource,
      },
    });
    return reply;
  });
}

export interface ReminderRunResult {
  scanned: number;
  candidates: number;
  created: number;
  skippedDuplicate: number;
}

/**
 * 催办扫描(Cron 调用)。
 * 幂等键由领域函数产出;唯一约束命中即跳过 —— **防重复发送**(SPEC §14)。
 * 本函数只落 ReminderLog(状态 PENDING),**不真的发邮件**:
 * 邮件通道属 PR8 的邮件适配器,当前为预览/模拟,不得声称已发送。
 */
export async function runReminderScan(
  session: SessionRef,
  now: string,
): Promise<ReminderRunResult> {
  const scope = await scopeFor(session, "OPO_LINE");
  const lines = await loadOpoLines(session.tenantId, scope);
  const candidates = collectReminderCandidates(lines, now);

  let created = 0;
  let skippedDuplicate = 0;

  for (const c of candidates) {
    const exists = await prisma.reminderLog.findFirst({
      where: tenantWhere(session.tenantId, { idempotencyKey: c.idempotencyKey }),
      select: { id: true },
    });
    if (exists) {
      skippedDuplicate += 1;
      continue;
    }
    await prisma.reminderLog.create({
      data: tenantData(session.tenantId, {
        opoLineId: c.line.id,
        idempotencyKey: c.idempotencyKey,
        channel: "EMAIL",
        status: "PENDING",
      }),
    });
    created += 1;
  }

  if (created > 0 || skippedDuplicate > 0) {
    await writeAudit(prisma, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "OPO_REMINDER_SCAN",
      entityType: "ReminderLog",
      entityId: `scan-${now.slice(0, 10)}`,
      after: { scanned: lines.length, candidates: candidates.length, created, skippedDuplicate },
    });
  }

  return { scanned: lines.length, candidates: candidates.length, created, skippedDuplicate };
}

/** 生成 ERP 导入模板的作业记录(API 不可回写时的替代路径,SPEC §14) */
export async function createErpExportJob(
  session: SessionRef,
  payload: Prisma.InputJsonValue,
  idempotencyKey: string,
) {
  const exists = await prisma.integrationJob.findFirst({
    where: tenantWhere(session.tenantId, { idempotencyKey }),
  });
  if (exists) return { job: exists, duplicated: true as const };

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.integrationJob.create({
      data: tenantData(session.tenantId, {
        type: "ERP_ORDER_EXPORT",
        status: "SUCCEEDED",
        idempotencyKey,
        payload,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "ERP_EXPORT_GENERATE",
      entityType: "IntegrationJob",
      entityId: created.id,
      after: { type: "ERP_ORDER_EXPORT", idempotencyKey },
    });
    return created;
  });
  return { job, duplicated: false as const };
}
