import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { resolveConflict } from "@/lib/server/repositories/erp-sync";

export const runtime = "nodejs";

const Input = z.object({
  resolution: z.enum(["ACCEPT_ERP", "KEEP_LOCAL", "MANUAL"]),
  manualValue: z.string().max(200).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ conflictId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.sync.resolve_conflict");
  if (!perm.ok) return perm.response;

  const { conflictId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const r = await resolveConflict(
    auth.session,
    conflictId,
    parsed.data.resolution,
    parsed.data.manualValue,
    parsed.data.note,
  );
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json({ ok: true });
}
