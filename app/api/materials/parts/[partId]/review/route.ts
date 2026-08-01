import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { reviewPart } from "@/lib/server/repositories/part-create";

export const runtime = "nodejs";

const Input = z.object({
  decision: z.enum(["ACTIVE", "REJECTED"]),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ partId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "material.review");
  if (!perm.ok) return perm.response;

  const { partId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const r = await reviewPart(auth.session, partId, parsed.data.decision, parsed.data.note);
  if (!r.ok) return NextResponse.json({ error: r.message }, { status: 422 });
  return NextResponse.json({ ok: true });
}
