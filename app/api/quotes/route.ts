import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { createQuote, listQuotes } from "@/lib/server/repositories/quote";

export const runtime = "nodejs";

const CreateInput = z.object({
  rfqId: z.string().min(1),
  customerId: z.string().min(1),
  currency: z.string().length(3).optional(),
  laborTemplateId: z.string().optional(),
});

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listQuotes(auth.session) });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PM" || r === "MANAGEMENT")) {
    return forbidden("仅 PM 或管理层可创建报价");
  }
  const parsed = CreateInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const created = await createQuote(auth.session, parsed.data);
  return NextResponse.json({ quote: created.quote, version: created.version }, { status: 201 });
}
