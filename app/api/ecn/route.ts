import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { createEcn } from "@/lib/server/repositories/ecn";

export const runtime = "nodejs";

const Input = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(["DESIGN_CHANGE", "EOL_REPLACEMENT", "PROCESS_CHANGE", "DOC_CHANGE", "OTHER"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  customerId: z.string().nullable().optional(),
  productName: z.string().trim().max(200).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** F2:创建 ECN(发起人 = PM/工程;管理层也可) */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PM" || r === "ENGINEERING" || r === "MANAGEMENT")) {
    return forbidden("仅 PM、工程或管理层可发起 ECN");
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });
  const r = await createEcn(auth.session, parsed.data);
  if (!r.ok) return badRequest(r.reason);
  return NextResponse.json({ ecnId: r.ecnId, code: r.code }, { status: 201 });
}
