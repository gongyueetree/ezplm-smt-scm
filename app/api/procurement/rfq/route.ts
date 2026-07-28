import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { createProcurementRfq, listProcurementRfqs } from "@/lib/server/repositories/procurement";

export const runtime = "nodejs";

const CreateInput = z.object({
  rfqId: z.string().nullable().optional(),
  bomVersionIds: z.array(z.string().min(1)).min(1),
  sourcingMode: z.enum(["SPOT", "FUTURES"]),
});

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listProcurementRfqs(auth.session) });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可创建采购 RFQ");
  }

  const parsed = CreateInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const prfq = await createProcurementRfq(auth.session, parsed.data);
  return NextResponse.json({ procurementRfq: prfq }, { status: 201 });
}
