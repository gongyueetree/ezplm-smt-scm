/**
 * closed-loop P0-7:统一 Integration Worker —— 消费 PENDING/RETRY_REQUIRED 的
 * ETA_WRITEBACK 记录并真正回写 ERP。
 *
 * 纪律(全部复用 F4 既有件):
 * - 抢占:条件更新 state→SYNCING(与 syncPurchaseOrderToErp 同一抢占语义);
 * - 幂等:记录上的 idempotencyKey 复用,**永不换键**;
 * - 分类:applySuccess/applyFailure(13+1 场景矩阵);
 * - 前置链:OPO 行 → PO → 该 PO 的 PURCHASE_ORDER 同步记录(externalId)——
 *   PO 未回写 ERP 时本记录 BLOCKED(人话说明先同步 PO),不猜外部单号;
 * - 供应商公开请求路径**不同步等待 ERP**:worker 由 Cron/手动触发,完全异步。
 */
import { randomUUID } from "crypto";
import {
  applyFailure,
  applySuccess,
  canAttempt,
  type IntegrationSyncState,
} from "@/lib/domain/integration-sync";
import { ErpNotConfiguredError, ErpNotImplementedError } from "@/lib/providers/erp";
import { ErpLabRequestError } from "@/lib/providers/erp/lab";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { resolveErpTarget } from "@/lib/server/repositories/integration-sync";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface WorkerRunResult {
  scanned: number;
  synced: number;
  retryRequired: number;
  failed: number;
  blocked: number;
  notConfigured: number;
  details: { recordId: string; entityId: string; state: string; note: string | null }[];
}

function toFailure(e: unknown) {
  if (e instanceof ErpLabRequestError) {
    return { code: e.code, retryable: e.retryable, httpStatus: e.httpStatus, message: e.message };
  }
  if (e instanceof ErpNotConfiguredError) return { code: "NOT_CONFIGURED", retryable: false, message: e.message };
  if (e instanceof ErpNotImplementedError) return { code: "NOT_IMPLEMENTED", retryable: false, message: e.message };
  return { code: "UNEXPECTED_ERROR", retryable: false, message: e instanceof Error ? e.message : String(e) };
}

/** 单条 ETA_WRITEBACK 的执行(抢占后调用) */
async function executeEtaWriteback(
  tenantId: string,
  record: { id: string; entityId: string; idempotencyKey: string | null },
  actorUserId: string,
): Promise<{ state: IntegrationSyncState; note: string | null }> {
  const correlationId = randomUUID();
  const finish = async (patch: {
    state: IntegrationSyncState;
    errorCode: string | null;
    errorMessage: string | null;
    externalId?: string | null;
    externalDocumentNo?: string | null;
    note?: string | null;
  }) => {
    await prisma.integrationSyncRecord.update({
      where: { id: record.id },
      data: {
        state: patch.state as never,
        errorCode: patch.errorCode,
        errorMessage: patch.errorMessage,
        ...(patch.externalId !== undefined ? { externalId: patch.externalId } : {}),
        ...(patch.externalDocumentNo !== undefined ? { externalDocumentNo: patch.externalDocumentNo } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        correlationId,
        lastAttemptAt: new Date(),
        ...(patch.state === "SYNCED" ? { syncedAt: new Date() } : {}),
      },
    });
    await writeAudit(prisma, {
      tenantId,
      userId: actorUserId,
      action: "ERP_SYNC_ETA_ATTEMPT",
      entityType: "IntegrationSyncRecord",
      entityId: record.id,
      after: { state: patch.state, errorCode: patch.errorCode, correlationId, actorType: "SYSTEM_WORKER" },
    });
    return { state: patch.state, note: patch.errorMessage ?? patch.note ?? null };
  };

  const target = await resolveErpTarget(tenantId);
  if (target.kind === "NONE") {
    return finish({ state: "NOT_CONFIGURED", errorCode: null, errorMessage: null, note: target.reason });
  }

  // 前置链:OPO 行 → 最新回复 → PO 的外部单号
  const opoLine = await prisma.oPOLine.findFirst({
    where: tenantWhere(tenantId, { id: record.entityId }),
    include: { replies: { orderBy: { replyAt: "desc" }, take: 1 } },
  });
  if (!opoLine) {
    return finish({ state: "FAILED", errorCode: "OPO_LINE_MISSING", errorMessage: "OPO 行不存在或已被清理" });
  }
  const reply = opoLine.replies[0];
  if (!reply) {
    return finish({ state: "FAILED", errorCode: "NO_REPLY", errorMessage: "没有可回写的供应商回复" });
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: tenantWhere(tenantId, { poNo: opoLine.poNo }),
    select: { id: true },
  });
  const poSync = po
    ? await prisma.integrationSyncRecord.findFirst({
        where: tenantWhere(tenantId, {
          entityType: "PURCHASE_ORDER" as const,
          entityId: po.id,
          state: "SYNCED" as const,
        }),
        select: { externalId: true, externalDocumentNo: true },
      })
    : null;
  if (!poSync?.externalId) {
    return finish({
      state: "BLOCKED",
      errorCode: "PO_NOT_SYNCED",
      errorMessage: `PO ${opoLine.poNo} 尚未回写 ERP(无外部单号)—— 请先在采购订单页执行「回写 ERP」,再重试本条`,
    });
  }

  try {
    const result = await target.provider.updateEta(
      { ...target.config, config: { ...target.config.config, correlationId } },
      {
        poExternalId: poSync.externalId,
        lineNo: opoLine.lineNo,
        confirmedQty: reply.replyQty ? reply.replyQty.toString() : null,
        eta: reply.replyEta ? reply.replyEta.toISOString().slice(0, 10) : null,
      },
    );
    const patch = applySuccess(result);
    return finish({
      state: patch.state,
      errorCode: null,
      errorMessage: null,
      externalId: patch.externalId,
      externalDocumentNo: patch.externalDocumentNo,
      note: patch.note,
    });
  } catch (e) {
    const patch = applyFailure(toFailure(e));
    return finish({ state: patch.state, errorCode: patch.errorCode, errorMessage: patch.errorMessage });
  }
}

/**
 * 跑一轮 worker:抢占并执行至多 `limit` 条待处理 ETA_WRITEBACK。
 * actorUserId 用于审计(Cron 触发时传系统占位并在 after 里标 SYSTEM_WORKER)。
 */
export async function runEtaWritebackWorker(
  tenantId: string,
  actorUserId: string,
  limit = 20,
): Promise<WorkerRunResult> {
  const candidates = await prisma.integrationSyncRecord.findMany({
    where: tenantWhere(tenantId, {
      entityType: "ETA_WRITEBACK" as const,
      state: { in: ["PENDING", "RETRY_REQUIRED"] as never[] },
    }),
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  const result: WorkerRunResult = {
    scanned: candidates.length,
    synced: 0,
    retryRequired: 0,
    failed: 0,
    blocked: 0,
    notConfigured: 0,
    details: [],
  };

  for (const record of candidates) {
    if (!canAttempt(record.state as IntegrationSyncState)) continue;
    // 抢占(并发 worker 只有一个赢)
    const claimed = await prisma.integrationSyncRecord.updateMany({
      where: { id: record.id, tenantId, state: { in: ["PENDING", "RETRY_REQUIRED"] as never[] } },
      data: { state: "SYNCING" as never, attemptCount: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    const outcome = await executeEtaWriteback(tenantId, record, actorUserId);
    result.details.push({ recordId: record.id, entityId: record.entityId, state: outcome.state, note: outcome.note });
    if (outcome.state === "SYNCED") result.synced += 1;
    else if (outcome.state === "RETRY_REQUIRED") result.retryRequired += 1;
    else if (outcome.state === "BLOCKED") result.blocked += 1;
    else if (outcome.state === "NOT_CONFIGURED") result.notConfigured += 1;
    else result.failed += 1;
  }
  return result;
}
