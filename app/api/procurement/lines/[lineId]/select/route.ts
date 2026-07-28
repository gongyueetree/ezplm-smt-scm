import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSelection } from "@/lib/domain/sourcing";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { selectQuoteLine } from "@/lib/server/repositories/procurement";

export const runtime = "nodejs";

const Input = z.object({
  recommendedKey: z.string().nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});

/** 采购选定供应商(SPEC §11:拒绝推荐必须写理由) */
export async function POST(req: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可选定供应商");
  }
  const { lineId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const check = validateSelection({
    selectedKey: lineId,
    recommendedKey: parsed.data.recommendedKey ?? null,
    reason: parsed.data.reason ?? null,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.errors[0].message, errors: check.errors }, { status: 422 });
  }

  const line = await selectQuoteLine(
    auth.session,
    lineId,
    parsed.data.reason ?? null,
    check.overrodeRecommendation,
  );
  if (!line) return notFound("报价行不存在或不属于当前租户");
  return NextResponse.json({ ok: true, overrodeRecommendation: check.overrodeRecommendation });
}
