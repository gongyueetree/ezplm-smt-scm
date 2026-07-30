import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { generateQuoteLinesFromBom } from "@/lib/server/repositories/quote-from-bom";

export const runtime = "nodejs";

const Input = z.object({ bomVersionId: z.string().min(1) });

/**
 * 从 BOM 版本批量生成报价行(报价页侧的入口)。
 * 逻辑在 `lib/server/repositories/quote-from-bom.ts`,与 BOM 页的一键转化共用同一份。
 */
export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { versionId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  const r = await generateQuoteLinesFromBom(auth.session, versionId, parsed.data.bomVersionId);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json({ ok: true, created: r.count, missingCost: r.missingCost, note: r.note });
}
