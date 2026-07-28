import { NextResponse } from "next/server";
import { z } from "zod";
import { RFQ_STATUSES } from "@/lib/domain/rfq-status";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { transitionRfqStatus } from "@/lib/server/repositories/rfq";

export const runtime = "nodejs";

const Input = z.object({
  to: z.enum(RFQ_STATUSES),
  reason: z.string().max(500).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const result = await transitionRfqStatus(
    auth.session,
    id,
    parsed.data.to,
    parsed.data.reason ?? null,
  );
  if (!result.ok) {
    if (result.code === "not_found") return notFound(result.message);
    // 业务规则拒绝(缺原因/越权/不允许的流转)统一 422,前端直接展示 message
    return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
