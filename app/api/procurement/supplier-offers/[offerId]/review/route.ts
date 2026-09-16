import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { reviewSupplierOffer } from "@/lib/server/repositories/rfq-supplier";

export const runtime = "nodejs";

const Input = z.object({ status: z.enum(["REVIEWED", "APPROVED", "REJECTED", "EXPIRED"]) });

/** R4-7(§37):报价审批 —— 人工;Customer Quote 默认只用 APPROVED */
export async function PATCH(req: Request, { params }: { params: Promise<{ offerId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("报价审批属采购/管理层");
  }
  const { offerId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");
  const r = await reviewSupplierOffer(auth.session, offerId, parsed.data.status);
  if (!r.ok) return badRequest(r.reason);
  return NextResponse.json({ ok: true });
}
