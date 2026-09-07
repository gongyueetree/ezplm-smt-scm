import { NextResponse } from "next/server";
import { forbidden, requireSession } from "@/lib/server/api";
import { runEtaWritebackWorker } from "@/lib/server/repositories/integration-worker";

export const runtime = "nodejs";

/** closed-loop P0-7:手动触发一轮 ETA 回写 worker(采购/管理层) */
export async function POST() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可触发集成 worker");
  }
  const result = await runEtaWritebackWorker(auth.session.tenantId, auth.session.userId);
  return NextResponse.json(result);
}
