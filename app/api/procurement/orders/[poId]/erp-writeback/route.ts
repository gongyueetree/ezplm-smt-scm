import { NextResponse } from "next/server";
import { forbidden, requireSession } from "@/lib/server/api";
import { syncPurchaseOrderToErp } from "@/lib/server/repositories/integration-sync";

export const runtime = "nodejs";

/**
 * F4:PO 的 API 直写回写(与既有 Excel 模板导出**并列**,不取代)。
 *
 * - ERP 未配置 → 422 + NOT_CONFIGURED,页面提示走 Excel 兜底链;
 * - 幂等键从业务身份推导且重试不变 —— 断网重试拿回原单,不重复建;
 * - 每次 attempt 落 IntegrationSyncRecord + 审计。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ poId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可回写 ERP");
  }
  const { poId } = await params;
  const outcome = await syncPurchaseOrderToErp(auth.session, poId);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
}
