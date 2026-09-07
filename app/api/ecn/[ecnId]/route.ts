import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { updateEcnHeader } from "@/lib/server/repositories/ecn";

export const runtime = "nodejs";

const Patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  type: z.enum(["DESIGN_CHANGE", "EOL_REPLACEMENT", "PROCESS_CHANGE", "DOC_CHANGE", "OTHER"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  customerId: z.string().nullable().optional(),
  productName: z.string().trim().max(200).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  effectiveStrategy: z.enum(["IMMEDIATE", "AFTER_WORK_ORDERS", "ON_DATE"]).nullable().optional(),
  effectiveAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** F2:草稿态头信息编辑(冻结判定在仓储层) */
export async function PUT(req: Request, { params }: { params: Promise<{ ecnId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PM" || r === "ENGINEERING" || r === "MANAGEMENT")) {
    return forbidden("仅 PM、工程或管理层可编辑 ECN");
  }
  const { ecnId } = await params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });
  const r = await updateEcnHeader(auth.session, ecnId, parsed.data);
  if (!r.ok) return badRequest(r.reason);
  return NextResponse.json({ ok: true });
}
