import { NextResponse } from "next/server";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { buildSupplierRfqExcel } from "@/lib/server/repositories/rfq-supplier";

export const runtime = "nodejs";

/** R4-7(§42):导出某供应商的线下 RFQ Excel(只含该供应商行清单) */
export async function GET(req: Request, { params }: { params: Promise<{ prfqId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("RFQ 导出属采购/管理层");
  }
  const { prfqId } = await params;
  const supplierId = new URL(req.url).searchParams.get("supplierId");
  if (!supplierId) return badRequest("需要 supplierId");
  const r = await buildSupplierRfqExcel(auth.session, prfqId, supplierId);
  if (!r.ok) return badRequest(r.reason);
  return new NextResponse(new Uint8Array(r.buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(r.fileName)}"`,
    },
  });
}
