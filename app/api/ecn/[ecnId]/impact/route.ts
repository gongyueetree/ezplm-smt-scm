import { NextResponse } from "next/server";
import { notFound, requireSession } from "@/lib/server/api";
import { gatherEcnImpact } from "@/lib/server/repositories/ecn-impact";
import { isFeatureEnabled } from "@/lib/server/tenant-settings";

export const runtime = "nodejs";

/** F2(T2):影响分析。flag 关闭时 404(关闭的功能不存在);只读,不做任何自动动作 */
export async function GET(_req: Request, { params }: { params: Promise<{ ecnId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!(await isFeatureEnabled(auth.session.tenantId, "ecn.impactAnalysis"))) {
    return notFound("该功能未启用(租户 Feature Flag ecn.impactAnalysis)");
  }
  const { ecnId } = await params;
  const impact = await gatherEcnImpact(auth.session.tenantId, ecnId);
  if (!impact) return notFound("ECN 不存在或不属于当前租户");
  return NextResponse.json(impact);
}
