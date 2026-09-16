import { NextResponse } from "next/server";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { historicalPurchaseStats } from "@/lib/server/repositories/price-pool";

export const runtime = "nodejs";

/** R4-9(§51):历史采购价 —— Last/Lowest/Highest(按料;可选 supplier/mpn/日期窗) */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT" || r === "PM")) {
    return forbidden("历史采购价属采购/PM/管理层");
  }
  const url = new URL(req.url);
  const partId = url.searchParams.get("partId");
  if (!partId) return badRequest("需要 partId");
  const stats = await historicalPurchaseStats({
    tenantId: auth.session.tenantId,
    partId,
    supplierId: url.searchParams.get("supplierId"),
    mpn: url.searchParams.get("mpn"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  return NextResponse.json(stats);
}
