import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { retryJob } from "@/lib/server/repositories/erp-sync";

export const runtime = "nodejs";

/**
 * 重跑同步作业(PR-D)。
 *
 * 只重试**失败行**,已成功的行不重复同步。
 * 人工触发不受退避与次数限制 —— 人比调度器更清楚现在能不能重试。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.sync.execute");
  if (!perm.ok) return perm.response;

  const { jobId } = await params;
  const r = await retryJob(auth.session, jobId, { manual: true });
  if (!r.ok) {
    return NextResponse.json({ error: r.reason, code: r.code }, { status: r.code === "not_found" ? 404 : 422 });
  }
  return NextResponse.json({
    jobId: r.jobId,
    retryLines: r.retryLineNos.length,
    skippedAlreadySucceeded: r.skipped,
    note: r.note,
  });
}
