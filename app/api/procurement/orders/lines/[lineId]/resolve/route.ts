import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { resolvePoLineFlag } from "@/lib/server/repositories/purchase-order";

export const runtime = "nodejs";

/** 异常处理结论:默认空,逐项人工选(与比价页同一套口径) */
const Input = z.object({
  resolution: z.enum(["ACCEPT", "REQUOTE", "SWITCH_SOURCE", "ADJUST_PRICE"]),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { lineId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const r = await resolvePoLineFlag(auth.session, lineId, parsed.data.resolution, parsed.data.note);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json({ ok: true });
}
