import { NextResponse } from "next/server";
import { notFound, requireSession } from "@/lib/server/api";
import { submitQuoteForApproval } from "@/lib/server/repositories/quote";

export const runtime = "nodejs";

/** 提交审批:分类未全部人工确认即 422 并指出是哪几行 */
export async function POST(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { versionId } = await params;

  const result = await submitQuoteForApproval(auth.session, versionId);
  if (!result.ok) {
    if (result.code === "not_found") return notFound(result.message);
    return NextResponse.json(
      { error: result.message, code: result.code, unconfirmedLines: result.unconfirmedLines },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true, status: result.status });
}
