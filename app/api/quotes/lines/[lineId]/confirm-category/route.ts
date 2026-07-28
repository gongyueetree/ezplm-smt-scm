import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { confirmLineCategory } from "@/lib/server/repositories/quote";

export const runtime = "nodejs";

const Input = z.object({ materialCategory: z.string().min(1).max(50) });

/** 人工确认物料分类(AI 填的分类不会自动算已确认) */
export async function POST(req: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { lineId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  const result = await confirmLineCategory(auth.session, lineId, parsed.data.materialCategory);
  if (!result.ok) {
    if (result.code === "not_found") return notFound(result.message);
    return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
