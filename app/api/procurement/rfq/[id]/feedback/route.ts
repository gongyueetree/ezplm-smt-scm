import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { submitFeedbackToPm } from "@/lib/server/repositories/procurement";

export const runtime = "nodejs";

const Input = z.object({ note: z.string().max(1000).nullable().optional() });

/** 反馈 PM(CLAUDE.md 铁律 5:全部原始异常行处理完毕方可提交) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可反馈 PM");
  }
  const { id } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("参数不合法");

  const result = await submitFeedbackToPm(auth.session, id, parsed.data.note ?? null);
  if (!result.ok) {
    if (result.code === "not_found") return notFound("采购 RFQ 不存在或不属于当前租户");
    return NextResponse.json(
      {
        error: `还有 ${result.progress?.unresolved} 个原始异常行未处理,不能反馈 PM`,
        progress: result.progress,
      },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true, progress: result.progress });
}
