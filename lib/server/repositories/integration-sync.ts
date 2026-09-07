/**
 * F4:实体级同步状态的编排(取数、落库、审计)。
 *
 * 状态判定与失败分类全在 `lib/domain/integration-sync.ts`(纯函数);
 * 这里只做:解析租户的 ERP 目标 → 拿/建状态记录 → 发起尝试 → 按结果落状态 + 审计。
 *
 * 并发纪律(与 ErpSyncJob 的租约同一思想,但粒度是**单个业务对象**):
 * - 唯一集成键(tenantId+provider+entityType+entityId+direction)保证一个对象一条记录;
 * - 发起尝试前用**条件更新**抢状态(state ∈ 可尝试集合 → SYNCING),
 *   `updateMany` 返回 0 行即说明别人已在同步,本次直接放弃 —— 不做先查再改。
 *
 * 幂等纪律:幂等键在记录创建时生成一次,之后**只读不写**。
 * NETWORK_DROP_AFTER_COMMIT 的重试正确性完全依赖这一条。
 */
import { randomUUID } from "crypto";
import type { ErpEntityType, Prisma } from "@prisma/client";
import {
  applyFailure,
  applySuccess,
  buildIntegrationKey,
  canManualRetry,
  type AttemptOutcomePatch,
} from "@/lib/domain/integration-sync";
import { ErpNotConfiguredError, ErpNotImplementedError } from "@/lib/providers/erp";
import { ErpLabRequestError, HttpErpLabProvider, resolveErpLabEnv } from "@/lib/providers/erp/lab";
import type { ErpProvider } from "@/lib/providers/erp/types";
import type { ErpConnectionConfig, ErpCreatePoInput } from "@/lib/providers/erp/types";
import { getTenantSettings } from "@/lib/server/tenant-settings";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

/** 空配置:ERP_LAB 的目标与令牌来自环境变量,不走 ErpConnection 凭据 */
const LAB_CONFIG: ErpConnectionConfig = { vendor: "ERP_LAB", config: {}, secrets: {} };

export type ErpTarget =
  | { kind: "ERP_LAB"; provider: ErpProvider; config: ErpConnectionConfig }
  | { kind: "KINGDEE"; provider: ErpProvider; config: ErpConnectionConfig }
  | { kind: "NONE"; reason: string };

/**
 * 解析租户当前生效的 ERP 回写目标(TenantSettings.erpProvider)。
 *
 * NONE / 凭据缺失都返回 kind:"NONE" + 人话原因 ——
 * 调用方据此把记录落 NOT_CONFIGURED,并保证 **Excel 兜底链始终可用**。
 */
export async function resolveErpTarget(tenantId: string): Promise<ErpTarget> {
  const { settings } = await getTenantSettings(tenantId);
  switch (settings.erpProvider) {
    case "ERP_LAB": {
      if (!process.env.ERP_LAB_BASE_URL?.trim() || !process.env.ERP_LAB_ACCESS_TOKEN?.trim()) {
        return {
          kind: "NONE",
          reason:
            "租户已选 ERP 仿真环境,但服务端缺少 ERP_LAB_BASE_URL / ERP_LAB_ACCESS_TOKEN —— 状态保持「ERP 未配置」,Excel 模板兜底可用",
        };
      }
      // closed-loop P0-2:按租户配置选择 Lab 数据集(未配置回落 ezplm-demo 仅供演示;
      // 客户数据集必须显式配置 erpLabTenantId,严禁多租户共用)
      const provider = new HttpErpLabProvider(resolveErpLabEnv(settings.erpLabTenantId));
      return { kind: "ERP_LAB", provider, config: LAB_CONFIG };
    }
    case "KINGDEE":
      // 金蝶凭据在 ErpConnection 里管理;API 直写待联调(O1),当前一律走 Excel 兜底
      return {
        kind: "NONE",
        reason: "金蝶 API 直写待联调(等待客户凭据,OPEN-QUESTIONS O1)—— 请使用 Excel 模板兜底链",
      };
    case "NONE":
      return { kind: "NONE", reason: "租户未启用 ERP 集成 —— Excel 模板兜底可用" };
  }
}

function toFailure(e: unknown): { code: string; retryable: boolean; httpStatus?: number; message?: string } {
  if (e instanceof ErpLabRequestError) {
    return { code: e.code, retryable: e.retryable, httpStatus: e.httpStatus, message: e.message };
  }
  if (e instanceof ErpNotConfiguredError) {
    return { code: "NOT_CONFIGURED", retryable: false, message: e.message };
  }
  if (e instanceof ErpNotImplementedError) {
    return { code: "NOT_IMPLEMENTED", retryable: false, message: e.message };
  }
  return { code: "UNEXPECTED_ERROR", retryable: false, message: e instanceof Error ? e.message : String(e) };
}

async function applyPatch(
  session: SessionRef,
  recordId: string,
  patch: AttemptOutcomePatch,
  extra: { action: string; entityType: string; entityId: string; snapshot?: unknown },
) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.integrationSyncRecord.update({
      where: { id: recordId },
      data: {
        state: patch.state,
        errorCode: patch.errorCode,
        errorMessage: patch.errorMessage,
        ...(patch.externalId !== undefined ? { externalId: patch.externalId } : {}),
        ...(patch.externalDocumentNo !== undefined ? { externalDocumentNo: patch.externalDocumentNo } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        lastAttemptAt: now,
        ...(patch.state === "SYNCED"
          ? {
              syncedAt: now,
              ...(extra.snapshot !== undefined
                ? { syncedSnapshot: extra.snapshot as Prisma.InputJsonValue }
                : {}),
            }
          : {}),
      },
    });
    // 每次 attempt 都审计 —— 成功失败都要能回放
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: extra.action,
      entityType: extra.entityType,
      entityId: extra.entityId,
      after: {
        state: patch.state,
        errorCode: patch.errorCode,
        externalId: patch.externalId ?? null,
        externalDocumentNo: patch.externalDocumentNo ?? null,
      },
    });
  });
}

export type PoWritebackOutcome =
  | { ok: true; state: string; externalId: string | null; documentNo: string | null; idempotentReplay: boolean }
  | { ok: false; state: string; reason: string };

/**
 * 把一张**已批准**的 PO 回写到 ERP(单笔 createPurchaseOrder + 幂等键)。
 *
 * 行 → Lab 物料编码的口径:优先 Part.internalPn,其次行上的 MPN ——
 * ERP 侧不认识时会返回 MATERIAL_NOT_FOUND,状态落 FAILED 等人工修数据,
 * **不做任何模糊匹配**(把 A 料写成 B 料比写失败严重得多)。
 */
export async function syncPurchaseOrderToErp(
  session: SessionRef,
  poId: string,
): Promise<PoWritebackOutcome> {
  const target = await resolveErpTarget(session.tenantId);
  const po = await prisma.purchaseOrder.findFirst({
    where: tenantWhere(session.tenantId, { id: poId }),
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!po) return { ok: false, state: "NOT_FOUND", reason: "订单不存在或不属于当前租户" };
  if (po.status !== "APPROVED" && po.status !== "EXPORTED") {
    return { ok: false, state: "INVALID_STATUS", reason: "只有已批准的订单可回写 ERP(与 Excel 导出同一门槛)" };
  }

  const key = buildIntegrationKey({
    tenantId: session.tenantId,
    entityType: "PURCHASE_ORDER",
    entityId: po.id,
  });
  const providerName = target.kind === "NONE" ? "NONE" : target.kind;

  // 记录 upsert(唯一集成键):已有记录**不改幂等键**
  const record = await prisma.integrationSyncRecord.upsert({
    where: {
      tenantId_provider_entityType_entityId_direction: {
        tenantId: session.tenantId,
        provider: providerName,
        entityType: "PURCHASE_ORDER",
        entityId: po.id,
        direction: "EZPLM_TO_ERP",
      },
    },
    update: {},
    create: tenantData(session.tenantId, {
      provider: providerName,
      entityType: "PURCHASE_ORDER",
      entityId: po.id,
      direction: "EZPLM_TO_ERP",
      state: target.kind === "NONE" ? "NOT_CONFIGURED" : "PENDING",
      idempotencyKey: key,
    }),
  });

  if (target.kind === "NONE") {
    if (record.state !== "NOT_CONFIGURED") {
      await prisma.integrationSyncRecord.update({
        where: { id: record.id },
        data: { state: "NOT_CONFIGURED", note: target.reason },
      });
    }
    return { ok: false, state: "NOT_CONFIGURED", reason: target.reason };
  }

  // 已同步的单不重复回写(要改单走 ERP 侧或作废重来;这里不覆盖)
  if (record.state === "SYNCED") {
    return {
      ok: true,
      state: "SYNCED",
      externalId: record.externalId,
      documentNo: record.externalDocumentNo,
      idempotentReplay: true,
    };
  }

  const correlationId = randomUUID(); // closed-loop P1-10:业务动作→记录→Lab 日志一条链

  // 条件抢占:并发调用只有一个能把状态推进到 SYNCING
  const claimed = await prisma.integrationSyncRecord.updateMany({
    where: {
      id: record.id,
      tenantId: session.tenantId,
      state: { in: ["PENDING", "RETRY_REQUIRED", "FAILED", "BLOCKED", "NOT_CONFIGURED", "READY"] },
    },
    data: { state: "SYNCING", attemptCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    return { ok: false, state: "SYNCING", reason: "该订单正在同步中(并发抢占失败),请稍后查看状态" };
  }
  await prisma.integrationSyncRecord.update({ where: { id: record.id }, data: { correlationId } });

  // 组装 ERP 单据。物料编码:internalPn 优先、MPN 兜底 —— 都没有则该行无法回写
  const partIds = po.lines.map((l) => l.partId).filter((x): x is string => Boolean(x));
  const parts = partIds.length
    ? await prisma.part.findMany({
        where: tenantWhere(session.tenantId, { id: { in: partIds } }),
        select: { id: true, internalPn: true },
      })
    : [];
  const pnOf = new Map(parts.map((p) => [p.id, p.internalPn]));
  const supplier = await prisma.supplier.findFirst({
    where: tenantWhere(session.tenantId, { id: po.supplierId }),
    select: { code: true },
  });

  const missing = po.lines.filter((l) => !(l.partId && pnOf.get(l.partId)) && !l.mpn);
  if (!supplier || missing.length > 0) {
    const patch = applyFailure({
      code: "VALIDATION_ERROR",
      retryable: false,
      message: !supplier
        ? "供应商档案缺失"
        : `${missing.length} 行既无内部料号也无 MPN,无法映射 ERP 物料编码`,
    });
    await applyPatch(session, record.id, patch, {
      action: "ERP_SYNC_PO_ATTEMPT",
      entityType: "PURCHASE_ORDER",
      entityId: po.id,
    });
    return { ok: false, state: patch.state, reason: patch.errorMessage ?? "校验失败" };
  }

  const input: ErpCreatePoInput = {
    supplierCode: supplier.code,
    currency: po.currency,
    orderDate: po.createdAt.toISOString().slice(0, 10),
    lines: po.lines.map((l) => ({
      lineNo: l.lineNo,
      materialCode: (l.partId ? pnOf.get(l.partId) : null) ?? l.mpn!,
      qty: l.qty.toString(),
      unitPrice: (l.unitPrice ?? 0).toString(),
      requestedDate: l.requestDate ? l.requestDate.toISOString().slice(0, 10) : null,
    })),
  };

  try {
    const result = await target.provider.createPurchaseOrder(
      { ...target.config, config: { ...target.config.config, correlationId } },
      input,
      record.idempotencyKey ?? key,
    );
    const patch = applySuccess(result);
    await applyPatch(session, record.id, patch, {
      action: "ERP_SYNC_PO_ATTEMPT",
      entityType: "PURCHASE_ORDER",
      entityId: po.id,
      snapshot: { input, result },
    });
    return {
      ok: true,
      state: patch.state,
      externalId: patch.externalId ?? null,
      documentNo: patch.externalDocumentNo ?? null,
      idempotentReplay: result.idempotentReplay,
    };
  } catch (e) {
    const patch = applyFailure(toFailure(e));
    await applyPatch(session, record.id, patch, {
      action: "ERP_SYNC_PO_ATTEMPT",
      entityType: "PURCHASE_ORDER",
      entityId: po.id,
    });
    return { ok: false, state: patch.state, reason: patch.errorMessage ?? "同步失败" };
  }
}

/** 数据集级实体(读取方向):entityId 固定为 "dataset" */
const DATASET_ENTITIES: ErpEntityType[] = [
  "MATERIAL",
  "INVENTORY",
  "EXCESS",
  "SUPPLIER",
  "CUSTOMER",
  "FX_RATE",
  "OPEN_PO",
];

export interface SyncStatusRow {
  id: string;
  provider: string;
  entityType: string;
  entityId: string;
  direction: string;
  state: string;
  externalId: string | null;
  externalDocumentNo: string | null;
  attemptCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  note: string | null;
  lastAttemptAt: string | null;
  syncedAt: string | null;
  correlationId: string | null;
  canRetry: boolean;
}

/**
 * 状态页数据:真实记录 + 未配置时的**虚拟 NOT_CONFIGURED 行**(数据集实体)。
 * 虚拟行不落库 —— 没配 ERP 就往库里写一排记录只是噪音;页面要显示的
 * 是"这些实体当前无 ERP 可同步",这由 target 直接推出。
 */
export async function listSyncStatus(session: SessionRef): Promise<{
  target: { kind: string; reason: string | null };
  records: SyncStatusRow[];
  datasets: { entityType: string; state: string; note: string }[];
}> {
  const target = await resolveErpTarget(session.tenantId);
  const rows = await prisma.integrationSyncRecord.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: [{ entityType: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });

  const records: SyncStatusRow[] = rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    entityType: r.entityType,
    entityId: r.entityId,
    direction: r.direction,
    state: r.state,
    externalId: r.externalId,
    externalDocumentNo: r.externalDocumentNo,
    attemptCount: r.attemptCount,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    note: r.note,
    lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
    syncedAt: r.syncedAt?.toISOString() ?? null,
    correlationId: r.correlationId,
    canRetry: canManualRetry(r.state as never),
  }));

  const covered = new Set(rows.filter((r) => r.entityId === "dataset").map((r) => r.entityType as string));
  const datasets = DATASET_ENTITIES.filter((e) => !covered.has(e)).map((e) => ({
    entityType: e,
    state: target.kind === "NONE" ? "NOT_CONFIGURED" : "READY",
    note:
      target.kind === "NONE"
        ? (target as { reason: string }).reason
        : e === "FX_RATE"
          ? "状态位已就绪;**汇率数值不落库**(口径待客户答复 O3),同步只登记状态"
          : "ERP 目标已配置,尚未发起过同步",
  }));

  return {
    target: {
      kind: target.kind,
      reason: target.kind === "NONE" ? (target as { reason: string }).reason : null,
    },
    records,
    datasets,
  };
}

/** 人工重试:只允许 RETRY_REQUIRED / FAILED / BLOCKED;复用原幂等键(由 sync 函数保证) */
export async function retrySyncRecord(
  session: SessionRef,
  recordId: string,
): Promise<PoWritebackOutcome> {
  const record = await prisma.integrationSyncRecord.findFirst({
    where: tenantWhere(session.tenantId, { id: recordId }),
  });
  if (!record) return { ok: false, state: "NOT_FOUND", reason: "记录不存在或不属于当前租户" };
  if (!canManualRetry(record.state as never)) {
    return { ok: false, state: record.state, reason: `状态「${record.state}」不可人工重试` };
  }
  if (record.entityType === "PURCHASE_ORDER") {
    return syncPurchaseOrderToErp(session, record.entityId);
  }
  return { ok: false, state: record.state, reason: "该实体类型暂不支持人工重试(数据集拉取请走同步页)" };
}
