import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { createRfq, listRfqs } from "@/lib/server/repositories/rfq";

export const runtime = "nodejs";

const CreateInput = z.object({
  customerId: z.string().min(1),
  title: z.string().min(1).max(200),
  quoteQtys: z.array(z.number().int().positive()).max(10).optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listRfqs(auth.session) });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  if (!auth.session.roles.some((r) => r === "PM" || r === "MANAGEMENT")) {
    return NextResponse.json({ error: "仅 PM 或管理层可创建 RFQ" }, { status: 403 });
  }

  const parsed = CreateInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const rfq = await createRfq(auth.session, {
    customerId: parsed.data.customerId,
    title: parsed.data.title,
    quoteQtys: parsed.data.quoteQtys,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
  });
  return NextResponse.json({ rfq }, { status: 201 });
}
