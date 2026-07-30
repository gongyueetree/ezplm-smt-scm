import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { canAccessKind } from "@/lib/server/recon-access";
import { createStatement } from "@/lib/server/repositories/reconciliation";

export const runtime = "nodejs";

const Input = z.object({
  kind: z.enum(["AR", "AP"]),
  code: z.string().trim().min(1).max(50),
  customerId: z.string().trim().nullable().optional(),
  supplierId: z.string().trim().nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  periodFrom: z.string().nullable().optional(),
  periodTo: z.string().nullable().optional(),
  amountTolerance: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");
  if (!canAccessKind(auth.session.roles, parsed.data.kind)) {
    return forbidden(
      parsed.data.kind === "AR" ? "应收对账属 PM 侧" : "应付对账属采购侧",
    );
  }

  const st = await createStatement(auth.session, parsed.data);
  return NextResponse.json({ id: st.id, code: st.code }, { status: 201 });
}
