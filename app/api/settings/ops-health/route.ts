import { NextResponse } from "next/server";
import type { JobStatus } from "@prisma/client";
import { requireSession } from "@/lib/server/api";
import { computeJobMetrics, type JobSample } from "@/lib/domain/ops-metrics";
import { requirePermission } from "@/lib/server/permissions";
import { connectionHealth } from "@/lib/server/repositories/erp-sync";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * 运维健康总览(PR-H)。
 *
 * 把已有数据汇总成运维真正要问的问题:
 * 成功率多少、平均要重试几次、哪个连接在拖后腿、有多少作业卡在人工队列。
 *
 * 纪律:**无样本一律返回 null**,由前端显示为「无样本」——
 * 0% 成功率与"这周没跑过"是两回事,前者要立刻处理,后者只是没数据。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.connection.view");
  if (!perm.ok) return perm.response;

  // 非数值参数会算出 NaN,进而生成 Invalid Date 传给查询 —— 必须先挡住
  const raw = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const days = Number.isFinite(raw) ? Math.min(90, Math.max(1, Math.trunc(raw))) : 7;
  const since = new Date(Date.now() - days * 86_400_000);

  const [jobs, connections, conflicts, pendingRetry] = await Promise.all([
    prisma.erpSyncJob.findMany({
      where: tenantWhere(auth.session.tenantId, { createdAt: { gte: since } }),
      select: {
        status: true,
        startedAt: true,
        finishedAt: true,
        retryCount: true,
        createdCount: true,
        updatedCount: true,
        unchangedCount: true,
        skippedCount: true,
        conflictCount: true,
        failedCount: true,
        connectionId: true,
        entityType: true,
      },
      take: 5000,
    }),
    connectionHealth(auth.session),
    prisma.erpConflict.count({
      where: tenantWhere(auth.session.tenantId, { resolution: null }),
    }),
    prisma.erpSyncJob.count({
      where: tenantWhere(auth.session.tenantId, { status: "RETRYING" satisfies JobStatus as JobStatus }),
    }),
  ]);

  const toSample = (j: (typeof jobs)[number]): JobSample => ({
    status: j.status,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    retryCount: j.retryCount,
    createdCount: j.createdCount,
    updatedCount: j.updatedCount,
    unchangedCount: j.unchangedCount,
    skippedCount: j.skippedCount,
    conflictCount: j.conflictCount,
    failedCount: j.failedCount,
  });

  // 分连接统计 —— 回答"哪个连接在拖后腿"
  const byConnection = new Map<string, JobSample[]>();
  for (const j of jobs) {
    const arr = byConnection.get(j.connectionId) ?? [];
    arr.push(toSample(j));
    byConnection.set(j.connectionId, arr);
  }
  const connName = new Map(connections.map((c) => [c.id, c.name]));

  return NextResponse.json({
    windowDays: days,
    overall: computeJobMetrics(jobs.map(toSample)),
    perConnection: [...byConnection.entries()].map(([connectionId, samples]) => ({
      connectionId,
      name: connName.get(connectionId) ?? connectionId,
      metrics: computeJobMetrics(samples),
    })),
    connections,
    /** 待人工处理:冲突队列与待重试 */
    queues: { unresolvedConflicts: conflicts, pendingRetry },
    asOf: new Date().toISOString(),
  });
}
