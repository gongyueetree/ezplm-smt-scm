import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { resolveFlaggedLine } from "@/lib/server/repositories/procurement";

export const runtime = "nodejs";

const Input = z.object({
  resolution: z.enum(["ACCEPT", "REQUOTE", "SWITCH_SOURCE", "ADJUST_PRICE"]),
  resolutionNote: z.string().max(500).nullable().optional(),
  replacement: z
    .object({
      supplierId: z.string(),
      unitPrice: z.string(),
      currency: z.string(),
      moq: z.number().nullable(),
      spq: z.number().nullable(),
      leadTimeDays: z.number().nullable(),
      quotedAt: z.string(),
    })
    .nullable()
    .optional(),
  thresholds: z.object({
    currency: z.string(),
    maxUnitPrice: z.string().nullable().optional(),
    maxLeadTimeDays: z.number().nullable().optional(),
  }),
});

/** 处理异常行(CLAUDE.md 铁律 3/4:新价重过校验、换货源七要素齐备) */
export async function POST(req: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可处理报价异常");
  }
  const { lineId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const result = await resolveFlaggedLine(auth.session, { lineId, ...parsed.data });
  if (!result.ok) {
    if (result.code === "not_found") return notFound("报价行不存在或不属于当前租户");
    // 业务规则拒绝(缺新价/缺换货源要素/新价仍超线)
    return NextResponse.json({ error: "处理结论不成立", errors: result.errors }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
