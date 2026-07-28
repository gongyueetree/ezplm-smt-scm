import { NextResponse } from "next/server";
import { notFound, requireSession } from "@/lib/server/api";
import { createRevision } from "@/lib/server/repositories/quote";

export const runtime = "nodejs";

/** 新建修订版:最大号 + 1,禁止覆盖任何既有版本 */
export async function POST(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { versionId } = await params;

  const result = await createRevision(auth.session, versionId);
  if (!result.ok) {
    if (result.code === "not_found") return notFound(result.message);
    return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
  }
  return NextResponse.json({ ok: true, ...result.data }, { status: 201 });
}
