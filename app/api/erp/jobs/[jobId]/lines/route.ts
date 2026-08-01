import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { listConflicts, listJobLines } from "@/lib/server/repositories/erp-sync";

export const runtime = "nodejs";

/** 行级日志 + 该作业的冲突清单 */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.connection.view");
  if (!perm.ok) return perm.response;
  const { jobId } = await params;
  const [lines, conflicts] = await Promise.all([
    listJobLines(auth.session, jobId),
    listConflicts(auth.session, jobId),
  ]);
  return NextResponse.json({ lines, conflicts });
}
