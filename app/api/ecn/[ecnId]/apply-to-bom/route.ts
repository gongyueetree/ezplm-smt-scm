import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { applyEcnToBom } from "@/lib/server/repositories/ecn";

export const runtime = "nodejs";

const Input = z.object({
  bomId: z.string().min(1),
  /** 二次确认:必须显式传 true(前端确认卡片点过之后);不是默认值 */
  confirm: z.literal(true),
});

/**
 * F2:Apply to BOM。仅 RELEASED;**不自动改 BOM** —— 生成新 BOMVersion(ecnId 回链),
 * 原版本一个字节不动;替换结果(命中/未命中)如实回报。
 */
export async function POST(req: Request, { params }: { params: Promise<{ ecnId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "ENGINEERING" || r === "MANAGEMENT")) {
    return forbidden("仅工程或管理层可执行 Apply to BOM");
  }
  const { ecnId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("需要 bomId 且显式确认(confirm: true)");
  const r = await applyEcnToBom(auth.session, ecnId, parsed.data.bomId);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json(r.result);
}
