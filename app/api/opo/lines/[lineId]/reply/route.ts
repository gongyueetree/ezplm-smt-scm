import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { recordOpoReply } from "@/lib/server/repositories/opo";

export const runtime = "nodejs";

const Input = z.object({
  replyEta: z.string().datetime().nullable(),
  replyQty: z.number().nonnegative().nullable(),
  replyNote: z.string().max(500).nullable().optional(),
  replySource: z.enum(["EMAIL", "PORTAL", "EXCEL", "PHONE", "MANUAL"]),
});

/** 记录供应商回复(五字段齐备,SPEC §14) */
export async function POST(req: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { lineId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const reply = await recordOpoReply(auth.session, {
    opoLineId: lineId,
    ...parsed.data,
    replyNote: parsed.data.replyNote ?? null,
  });
  if (!reply) return notFound("OPO 行不存在或不属于当前租户");
  return NextResponse.json({ ok: true });
}
