import { NextResponse } from "next/server";
import { z } from "zod";
import { QUOTE_COST_CATEGORIES } from "@/lib/domain/quote-calc";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { summarizeVersion, upsertQuoteLine } from "@/lib/server/repositories/quote";

export const runtime = "nodejs";

const Input = z.object({
  lineNo: z.number().int().positive(),
  category: z.enum(QUOTE_COST_CATEGORIES),
  qty: z.string().nullable().optional(),
  purchaseCost: z.string().nullable().optional(),
  markupPct: z.string().nullable().optional(),
  customerPrice: z.string().nullable().optional(),
  quotedMfg: z.string().nullable().optional(),
  quotedMpn: z.string().nullable().optional(),
  materialCategory: z.string().nullable().optional(),
  altMfg: z.string().nullable().optional(),
  altMpn: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** 写入报价行;PENDING/APPROVED 下会被冻结守卫拒绝(422) */
export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { versionId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const result = await upsertQuoteLine(auth.session, versionId, parsed.data);
  if (!result.ok) {
    if (result.code === "not_found") return notFound(result.message);
    return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
  }
  return NextResponse.json({
    line: result.data,
    summary: await summarizeVersion(auth.session, versionId),
  });
}
