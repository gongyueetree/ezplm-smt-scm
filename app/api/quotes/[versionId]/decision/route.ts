import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { decideQuoteApproval } from "@/lib/server/repositories/quote";

export const runtime = "nodejs";

const Input = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().max(1000).nullable().optional(),
});

/** 审批决定:退回必须填原因(422);通过时冻结 approvedSnapshot */
export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { versionId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  const result = await decideQuoteApproval(
    auth.session,
    versionId,
    parsed.data.decision,
    parsed.data.comment ?? null,
  );
  if (!result.ok) {
    if (result.code === "not_found") return notFound(result.message);
    return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
