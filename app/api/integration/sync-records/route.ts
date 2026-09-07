import { NextResponse } from "next/server";
import { forbidden, requireSession } from "@/lib/server/api";
import { listSyncStatus } from "@/lib/server/repositories/integration-sync";

export const runtime = "nodejs";

/** F4:实体级同步状态一览(状态页数据源)。 */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "MANAGEMENT" || r === "PROCUREMENT")) {
    return forbidden("仅管理层或采购可查看集成状态");
  }
  return NextResponse.json(await listSyncStatus(auth.session));
}
