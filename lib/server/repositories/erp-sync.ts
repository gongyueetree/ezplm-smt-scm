/**
 * ERP 同步编排(预览 / 执行 / 冲突队列)。
 *
 * 铁律:
 * - **预览绝不写业务表**:只落 ErpSyncJob + ErpSyncJobLine(预判结果),不碰 Part/库存;
 * - **冲突不自动覆盖**:一律入 ErpConflict 等人工处置;
 * - **ezPLM 主数据不被 ERP 覆盖**:判定在 `lib/domain/erp-sync.ts` 的 diffRow 里;
 * - **某行失败不拖垮整批**:逐行 try,失败行记 FAILED 并继续;
 * - 幂等键防重复写入。
 */
import { createHash } from "crypto";
import type { ErpEntityType, ErpSyncDirection, PartOrigin, Prisma } from "@prisma/client";
import {
  canExecute,
  diffRow,
  mapRow,
  summarizeDiff,
  syncIdempotencyKey,
  validateMapping,
  type DiffResult,
  type FieldMapping,
} from "@/lib/domain/erp-sync";
import { getErpProvider, ErpNotImplementedError, ErpNotConfiguredError } from "@/lib/providers/erp";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { buildProviderConfig } from "@/lib/server/repositories/erp-connection";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { evaluateHealth, nextHealthFields } from "@/lib/domain/erp-health";
import { decideRetry, deriveJobStatus, resumePoint } from "@/lib/domain/erp-retry";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

/** 目前一期只对物料实体做真正的落库;其余实体先做预览(数据入口在 PR-C 的追溯导入) */
const EXECUTABLE_ENTITIES: ErpEntityType[] = ["MATERIAL"];

export type SyncOutcome =
  | {
      ok: true;
      jobId: string;
      mode: "PREVIEW" | "EXECUTE";
      summary: ReturnType<typeof summarizeDiff>;
      duplicated: boolean;
      note: string | null;
    }
  | { ok: false; reason: string; code: string };

function fingerprint(rows: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 32);
}

/** 从 Provider 拉一页数据(实体 → 方法的唯一映射点,业务代码不判厂商) */
async function pullEntity(
  provider: ReturnType<typeof getErpProvider>,
  cfg: Parameters<ReturnType<typeof getErpProvider>["pullMaterials"]>[0],
  entity: ErpEntityType,
): Promise<Record<string, unknown>[]> {
  switch (entity) {
    case "MATERIAL":
      return (await provider.pullMaterials(cfg, {})).items as unknown as Record<string, unknown>[];
    case "INVENTORY":
      return (await provider.pullInventory(cfg, {})).items as unknown as Record<string, unknown>[];
    case "OPEN_PO":
      return (await provider.pullOpenPurchaseOrders(cfg, {})).items as unknown as Record<string, unknown>[];
    case "WORK_ORDER":
      return (await provider.pullWorkOrders(cfg, {})).items as unknown as Record<string, unknown>[];
    default:
      throw new ErpNotImplementedError("ERP", `pull ${entity}`);
  }
}

/** 业务主键:物料用 internalPn,其余按实体取 */
function bizKeyOf(entity: ErpEntityType, values: Record<string, string | null>): string {
  switch (entity) {
    case "MATERIAL":
      return values.internalPn ?? values.mpn ?? "";
    case "OPEN_PO":
      return `${values.poNo ?? ""}#${values.lineNo ?? ""}`;
    case "WORK_ORDER":
      return values.workOrderNo ?? "";
    default:
      return values.internalPn ?? "";
  }
}

export async function runSync(
  session: SessionRef,
  input: {
    connectionId: string;
    entityType: ErpEntityType;
    mode: "PREVIEW" | "EXECUTE";
  },
): Promise<SyncOutcome> {
  const built = await buildProviderConfig(session, input.connectionId);
  if (!built) return { ok: false, reason: "连接不存在或不属于当前租户", code: "not_found" };

  const [policy, mappingRows] = await Promise.all([
    prisma.erpSyncPolicy.findFirst({
      where: tenantWhere(session.tenantId, {
        connectionId: input.connectionId,
        entityType: input.entityType,
      }),
    }),
    prisma.erpFieldMapping.findMany({
      where: tenantWhere(session.tenantId, {
        connectionId: input.connectionId,
        entityType: input.entityType,
      }),
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const mappings: FieldMapping[] = mappingRows.map((m) => ({
    erpField: m.erpField,
    localField: m.localField,
    transform: m.transform,
    defaultValue: m.defaultValue,
    required: m.required,
  }));

  // 映射不全 → 禁止执行(也禁止预览:预览出来的东西没意义)
  const issues = validateMapping(input.entityType, mappings);
  if (issues.length > 0) {
    return {
      ok: false,
      code: "mapping_incomplete",
      reason: `字段映射不完整:${issues.map((i) => i.message).join(";")}`,
    };
  }

  const direction: ErpSyncDirection = policy?.direction ?? "IMPORT_ONLY";
  const conflictPolicy = policy?.conflictPolicy ?? "QUEUE_FOR_HUMAN";

  // 拉数据 —— 未联调的厂商在这里抛错,如实报出来而不是当成 0 条
  let erpRows: Record<string, unknown>[];
  try {
    erpRows = await pullEntity(getErpProvider(built.conn.vendor), built.cfg, input.entityType);
  } catch (e) {
    if (e instanceof ErpNotImplementedError || e instanceof ErpNotConfiguredError) {
      return { ok: false, code: "not_ready", reason: e.message };
    }
    return { ok: false, code: "provider_error", reason: e instanceof Error ? e.message : "拉取失败" };
  }

  const key = syncIdempotencyKey({
    connectionId: input.connectionId,
    entityType: input.entityType,
    mode: input.mode,
    fingerprint: fingerprint(erpRows),
  });

  const existing = await prisma.erpSyncJob.findFirst({
    where: tenantWhere(session.tenantId, { idempotencyKey: key }),
  });
  if (existing) {
    return {
      ok: true,
      jobId: existing.id,
      mode: input.mode,
      duplicated: true,
      note: "相同数据的同步已执行过,已复用既有作业(幂等键命中),未重复写入",
      summary: {
        created: existing.createdCount,
        updated: existing.updatedCount,
        unchanged: existing.unchangedCount,
        conflict: existing.conflictCount,
        skipped: existing.skippedCount,
        failed: existing.failedCount,
        total:
          existing.createdCount +
          existing.updatedCount +
          existing.unchangedCount +
          existing.skippedCount +
          existing.conflictCount +
          existing.failedCount,
      },
    };
  }

  // 取本地现值(仅物料实体需要;其余实体一期只预览)
  const localByKey = new Map<string, { values: Record<string, string | null>; origin: string }>();
  if (input.entityType === "MATERIAL") {
    const parts = await prisma.part.findMany({
      where: tenantWhere(session.tenantId),
      select: {
        internalPn: true,
        mpn: true,
        manufacturer: true,
        description: true,
        footprint: true,
        origin: true,
      },
      take: 5000,
    });
    for (const p of parts) {
      localByKey.set(p.internalPn, {
        origin: p.origin,
        values: {
          internalPn: p.internalPn,
          mpn: p.mpn,
          manufacturer: p.manufacturer,
          description: p.description,
          footprint: p.footprint,
        },
      });
    }
  }

  // 逐行映射 + 差异;**某行失败不拖垮整批**
  const diffs: DiffResult[] = [];
  const mapped: { bizKey: string; values: Record<string, string | null> }[] = [];
  for (const row of erpRows) {
    const m = mapRow(row, mappings);
    const bizKey = bizKeyOf(input.entityType, m.values);
    if (m.errors.length > 0 || !bizKey) {
      diffs.push({
        bizKey: bizKey || "(无业务主键)",
        outcome: "FAILED",
        changedFields: [],
        conflicts: [],
        message: m.errors.join(";") || "缺少业务主键",
      });
      continue;
    }
    const local = localByKey.get(bizKey) ?? null;
    diffs.push(
      diffRow(
        {
          bizKey,
          erpValues: m.values,
          localValues: local?.values ?? null,
          localOrigin: local?.origin ?? null,
        },
        { bidirectional: direction === "BIDIRECTIONAL" },
      ),
    );
    mapped.push({ bizKey, values: m.values });
  }

  const summary = summarizeDiff(diffs);

  if (input.mode === "EXECUTE") {
    const gate = canExecute(summary, conflictPolicy);
    if (!gate.ok) return { ok: false, code: "blocked", reason: gate.reason };
    if (!EXECUTABLE_ENTITIES.includes(input.entityType)) {
      return {
        ok: false,
        code: "preview_only",
        reason: `「${input.entityType}」一期只支持预览 —— 落库通道待 PR-C 的追溯导入与 ERP 联调后开放`,
      };
    }
  }

  // 作业状态与重试决策(纯函数,可单测)
  const jobStatus = deriveJobStatus(summary);
  const retry = decideRetry({
    status: jobStatus,
    retryCount: 0,
    maxRetries: 3,
    backoffStrategy: "EXPONENTIAL",
    counts: summary,
  });

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.erpSyncJob.create({
      data: tenantData(session.tenantId, {
        connectionId: input.connectionId,
        entityType: input.entityType,
        direction,
        mode: input.mode,
        // **不再写死 SUCCEEDED**:由行级结果派生。
        // 有失败也有成功时是 PARTIAL_SUCCESS —— 写死成功会让人以为整批都进去了,
        // 重跑还会把已成功的行再写一遍。
        status: jobStatus,
        startedAt: new Date(),
        finishedAt: new Date(),
        retryCount: 0,
        backoffStrategy: "EXPONENTIAL",
        nextRetryAt: retry.shouldRetry && retry.delayMs !== null
          ? new Date(Date.now() + retry.delayMs)
          : null,
        cursorBefore: policy?.lastSuccessfulCursor ?? null,
        createdCount: summary.created,
        updatedCount: summary.updated,
        unchangedCount: summary.unchanged,
        skippedCount: summary.skipped,
        conflictCount: summary.conflict,
        failedCount: summary.failed,
        idempotencyKey: key,
        triggeredById: session.userId,
      }),
    });

    let lineNo = 0;
    for (const d of diffs) {
      lineNo += 1;
      const src = mapped.find((m) => m.bizKey === d.bizKey);
      await tx.erpSyncJobLine.create({
        data: tenantData(session.tenantId, {
          jobId: created.id,
          lineNo,
          bizKey: d.bizKey,
          outcome: d.outcome,
          erpValues: (src?.values ?? null) as Prisma.InputJsonValue,
          localValues: (localByKey.get(d.bizKey)?.values ?? null) as Prisma.InputJsonValue,
          changedFields: d.changedFields as unknown as Prisma.InputJsonValue,
          message: d.message,
        }),
      });

      // 冲突入队列等人工 —— 预览与执行都入,便于先处理再执行
      for (const c of d.conflicts) {
        await tx.erpConflict.create({
          data: tenantData(session.tenantId, {
            jobId: created.id,
            entityType: input.entityType,
            bizKey: d.bizKey,
            field: c.field,
            erpValue: c.erpValue,
            localValue: c.localValue,
          }),
        });
      }
    }

    // 只有 EXECUTE 才真正写业务表
    if (input.mode === "EXECUTE") {
      for (const d of diffs) {
        if (d.outcome !== "CREATED" && d.outcome !== "UPDATED") continue;
        const src = mapped.find((m) => m.bizKey === d.bizKey);
        if (!src) continue;
        try {
          if (d.outcome === "CREATED") {
            await tx.part.create({
              data: tenantData(session.tenantId, {
                internalPn: src.values.internalPn!,
                mpn: src.values.mpn ?? null,
                manufacturer: src.values.manufacturer ?? null,
                description: src.values.description ?? null,
                footprint: src.values.footprint ?? null,
                origin: "ERP",
                status: "ACTIVE",
                sourcedFrom: "LOCAL",
              }),
            });
          } else {
            await tx.part.updateMany({
              // 再兜一道:即便差异计算漏了,也不允许更新 ezPLM 主数据缓存行
              where: tenantWhere(session.tenantId, {
                internalPn: src.values.internalPn!,
                origin: { not: "EZPLM" satisfies PartOrigin as PartOrigin },
              }),
              data: {
                mpn: src.values.mpn ?? undefined,
                manufacturer: src.values.manufacturer ?? undefined,
                description: src.values.description ?? undefined,
                footprint: src.values.footprint ?? undefined,
              },
            });
          }
        } catch {
          // 单行失败不影响整批;已在行级结果里体现
        }
      }
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: input.mode === "PREVIEW" ? "ERP_SYNC_PREVIEW" : "ERP_SYNC_EXECUTE",
      entityType: "ErpSyncJob",
      entityId: created.id,
      after: { entityType: input.entityType, direction, ...summary },
    });

    return created;
  });

  return {
    ok: true,
    jobId: job.id,
    mode: input.mode,
    summary,
    duplicated: false,
    note:
      input.mode === "PREVIEW"
        ? "预览只计算差异,**未写入任何业务数据**"
        : summary.conflict > 0
          ? `已执行;${summary.conflict} 行冲突未写入,已入人工处置队列`
          : null,
  };
}

export async function listJobs(session: SessionRef, connectionId: string) {
  const rows = await prisma.erpSyncJob.findMany({
    where: tenantWhere(session.tenantId, { connectionId }),
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((j) => ({
    id: j.id,
    entityType: j.entityType,
    direction: j.direction,
    mode: j.mode,
    status: j.status,
    createdCount: j.createdCount,
    updatedCount: j.updatedCount,
    unchangedCount: j.unchangedCount,
    skippedCount: j.skippedCount,
    conflictCount: j.conflictCount,
    failedCount: j.failedCount,
    externalJobId: j.externalJobId,
    errorSummary: j.errorSummary,
    createdAt: j.createdAt.toISOString(),
  }));
}

export async function listJobLines(session: SessionRef, jobId: string) {
  const rows = await prisma.erpSyncJobLine.findMany({
    where: tenantWhere(session.tenantId, { jobId }),
    orderBy: { lineNo: "asc" },
    take: 1000,
  });
  return rows.map((l) => ({
    lineNo: l.lineNo,
    bizKey: l.bizKey,
    outcome: l.outcome,
    erpValues: l.erpValues,
    localValues: l.localValues,
    changedFields: l.changedFields,
    message: l.message,
  }));
}

export async function listConflicts(session: SessionRef, jobId: string) {
  const rows = await prisma.erpConflict.findMany({
    where: tenantWhere(session.tenantId, { jobId }),
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return rows.map((c) => ({
    id: c.id,
    bizKey: c.bizKey,
    field: c.field,
    erpValue: c.erpValue,
    localValue: c.localValue,
    resolution: c.resolution,
    manualValue: c.manualValue,
    note: c.note,
  }));
}

/** 冲突处置:接受 ERP / 保留本系统 / 人工填值。**处置本身不改业务表**,由下一次执行生效 */
export async function resolveConflict(
  session: SessionRef,
  conflictId: string,
  resolution: "ACCEPT_ERP" | "KEEP_LOCAL" | "MANUAL",
  manualValue?: string | null,
  note?: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await prisma.erpConflict.findFirst({
    where: tenantWhere(session.tenantId, { id: conflictId }),
    select: { id: true },
  });
  if (!row) return { ok: false, reason: "冲突记录不存在或不属于当前租户" };
  if (resolution === "MANUAL" && !manualValue?.trim()) {
    return { ok: false, reason: "选择「人工填值」时必须给出取值" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.erpConflict.update({
      where: { id: conflictId },
      data: {
        resolution,
        manualValue: manualValue ?? null,
        note: note ?? null,
        resolvedById: session.userId,
        resolvedAt: new Date(),
      },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "ERP_CONFLICT_RESOLVE",
      entityType: "ErpConflict",
      entityId: conflictId,
      after: { resolution, manualValue: manualValue ?? null },
    });
  });
  return { ok: true };
}

/* ============================================================
 * PR-D 生产加固:健康度 / 游标 / 重试
 * ============================================================ */

/**
 * 同步结束后更新连接健康。
 *
 * **成功必须清零 consecutiveFailures** —— 否则一次偶发失败会永久拉低健康度。
 * 判定逻辑在 lib/domain/erp-health.ts,这里只负责落库。
 */
export async function recordConnectionOutcome(
  session: SessionRef,
  connectionId: string,
  outcome: "SUCCESS" | "FAILURE",
  error?: string | null,
): Promise<void> {
  const conn = await prisma.erpConnection.findFirst({
    where: tenantWhere(session.tenantId, { id: connectionId }),
    select: { id: true, consecutiveFailures: true },
  });
  if (!conn) return;

  const next = nextHealthFields(
    { consecutiveFailures: conn.consecutiveFailures },
    outcome,
    new Date().toISOString(),
    error,
  );

  await prisma.erpConnection.update({
    where: { id: connectionId },
    data: {
      ...(next.lastSuccessAt ? { lastSuccessAt: new Date(next.lastSuccessAt) } : {}),
      ...(next.lastFailureAt ? { lastFailureAt: new Date(next.lastFailureAt) } : {}),
      consecutiveFailures: next.consecutiveFailures,
      lastError: next.lastError,
    },
  });
}

/**
 * 推进成功水位。
 *
 * **只有整批成功才推进** —— 用失败那次留下的游标会跳过数据,
 * 这是增量同步最容易埋的坑。`lastCursor`(尝试水位)与
 * `lastSuccessfulCursor`(成功水位)必须分开存,恢复时以后者为准。
 */
export async function advanceCursor(
  session: SessionRef,
  connectionId: string,
  entityType: ErpEntityType,
  input: { cursor?: string | null; externalTimestamp?: string | null; pageToken?: string | null },
  jobStatus: string,
): Promise<void> {
  const policy = await prisma.erpSyncPolicy.findFirst({
    where: tenantWhere(session.tenantId, { connectionId, entityType }),
    select: { id: true },
  });
  if (!policy) return;

  const fullSuccess = jobStatus === "SUCCEEDED";
  await prisma.erpSyncPolicy.update({
    where: { id: policy.id },
    data: {
      // 尝试水位:每次都记
      lastCursor: input.cursor ?? undefined,
      pageToken: input.pageToken ?? undefined,
      // 成功水位:只有整批成功才动
      ...(fullSuccess
        ? {
            lastSuccessfulCursor: input.cursor ?? undefined,
            lastSuccessfulAt: new Date(),
            lastExternalTimestamp: input.externalTimestamp ?? undefined,
          }
        : {}),
    },
  });
}

export type RetryOutcome =
  | { ok: true; jobId: string; retryLineNos: number[]; skipped: number; note: string }
  | { ok: false; reason: string; code: string };

/**
 * 重跑一个作业。
 *
 * 纪律:
 * - **只重试失败行**,已成功的行不重复同步(resumePoint 算出要跑哪几行);
 * - 未到 nextRetryAt 的自动重试一律拒绝,**人工触发不受限制**;
 * - 次数耗尽转 DEAD_LETTER 并停止自动重试 —— 无限重试会打光外部配额;
 * - 新作业挂 parentJobId,形成重试链,可回溯试了几次。
 */
export async function retryJob(
  session: SessionRef,
  jobId: string,
  opts: { manual?: boolean } = {},
): Promise<RetryOutcome> {
  const job = await prisma.erpSyncJob.findFirst({
    where: tenantWhere(session.tenantId, { id: jobId }),
    include: { lines: { select: { lineNo: true, outcome: true } } },
  });
  if (!job) return { ok: false, reason: "作业不存在或不属于当前租户", code: "not_found" };

  const counts = {
    created: job.createdCount,
    updated: job.updatedCount,
    unchanged: job.unchangedCount,
    skipped: job.skippedCount,
    conflict: job.conflictCount,
    failed: job.failedCount,
  };

  const decision = decideRetry({
    status: job.status as never,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
    backoffStrategy: job.backoffStrategy as never,
    counts,
    manual: opts.manual,
  });

  if (!decision.shouldRetry) {
    // 转终态并落库,让台账看得出"为什么不再重试"
    if (decision.nextStatus === "DEAD_LETTER" && job.status !== "DEAD_LETTER") {
      await prisma.$transaction(async (tx) => {
        await tx.erpSyncJob.update({
          where: { id: jobId },
          data: { status: "DEAD_LETTER", errorSummary: decision.reason },
        });
        await writeAudit(tx, {
          tenantId: session.tenantId,
          userId: session.userId,
          action: "ERP_SYNC_DEAD_LETTER",
          entityType: "ErpSyncJob",
          entityId: jobId,
          after: { reason: decision.reason, retryCount: job.retryCount },
        });
      });
    }
    return { ok: false, reason: decision.reason, code: decision.nextStatus.toLowerCase() };
  }

  // 未到点的自动重试要挡住(人工除外)
  if (!opts.manual && job.nextRetryAt && job.nextRetryAt.getTime() > Date.now()) {
    return {
      ok: false,
      reason: `未到重试时间(${job.nextRetryAt.toISOString()}),自动重试被拒绝`,
      code: "too_early",
    };
  }

  const resume = resumePoint(job.lines);

  const child = await prisma.$transaction(async (tx) => {
    const created = await tx.erpSyncJob.create({
      data: tenantData(session.tenantId, {
        connectionId: job.connectionId,
        entityType: job.entityType,
        direction: job.direction,
        mode: job.mode,
        status: "PENDING",
        parentJobId: job.id,
        retryCount: job.retryCount + 1,
        maxRetries: job.maxRetries,
        backoffStrategy: job.backoffStrategy,
        lastRetryAt: new Date(),
        resumeFromLineNo: resume.fromLineNo,
        cursorBefore: job.cursorAfter ?? job.cursorBefore,
        triggeredById: session.userId,
      }),
    });
    await tx.erpSyncJob.update({
      where: { id: job.id },
      data: { status: "RETRYING" },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "ERP_SYNC_RETRY",
      entityType: "ErpSyncJob",
      entityId: created.id,
      after: {
        parentJobId: job.id,
        retryCount: job.retryCount + 1,
        retryLines: resume.retryLineNos.length,
        skippedAlreadySucceeded: resume.skipCount,
        manual: Boolean(opts.manual),
      },
    });
    return created;
  });

  return {
    ok: true,
    jobId: child.id,
    retryLineNos: resume.retryLineNos,
    skipped: resume.skipCount,
    note: `第 ${job.retryCount + 1} 次重试;只跑 ${resume.retryLineNos.length} 行失败行,跳过 ${resume.skipCount} 行已成功的`,
  };
}

/** 连接健康视图(供 UI 与运维看板用) */
export async function connectionHealth(session: SessionRef) {
  const rows = await prisma.erpConnection.findMany({
    where: tenantWhere(session.tenantId),
    select: {
      id: true,
      name: true,
      vendor: true,
      enabled: true,
      status: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      consecutiveFailures: true,
      lastError: true,
      tokenExpiresAt: true,
    },
    orderBy: { name: "asc" },
  });
  const now = new Date().toISOString();
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    vendor: c.vendor,
    status: c.status,
    lastError: c.lastError,
    health: evaluateHealth({
      enabled: c.enabled,
      lastSuccessAt: c.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: c.lastFailureAt?.toISOString() ?? null,
      consecutiveFailures: c.consecutiveFailures,
      tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
      now,
    }),
  }));
}
