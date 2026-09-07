import { NextResponse } from "next/server";
import { forbidden, requireSession } from "@/lib/server/api";
import { retrySyncRecord } from "@/lib/server/repositories/integration-sync";

export const runtime = "nodejs";

/**
 * F4:人工重试。只对 RETRY_REQUIRED / FAILED / BLOCKED 生效,
 * 幂等键复用原值 —— 「提交后断网」的单据重试会拿回原单,不重复建。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "MANAGEMENT" || r === "PROCUREMENT")) {
    return forbidden("仅管理层或采购可重试同步");
  }
  const { recordId } = await params;
  const outcome = await retrySyncRecord(auth.session, recordId);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
}
