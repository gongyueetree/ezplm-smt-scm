import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { saveLineDecision } from "@/lib/server/repositories/bom-import";

export const runtime = "nodejs";

const Input = z.object({
  decision: z.enum(["ACCEPT_CANDIDATE", "MANUAL_ASSIGN", "NO_MATCH"]),
  manualMpn: z.string().trim().min(1).max(100).nullable().optional(),
  manualManufacturer: z.string().trim().max(100).nullable().optional(),
  candidateId: z.string().nullable().optional(),
  partId: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** 人工确认(SPEC §6 第 8 步:正式匹配必须人工确认,AI 不定案) */
export async function POST(req: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { lineId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  if (parsed.data.decision === "MANUAL_ASSIGN" && !parsed.data.manualMpn && !parsed.data.partId) {
    return badRequest("人工指定需要填写型号(或选择本地物料)");
  }
  if (parsed.data.decision === "ACCEPT_CANDIDATE" && !parsed.data.candidateId) {
    return badRequest("采纳候选时必须指定 candidateId");
  }

  const saved = await saveLineDecision(auth.session, lineId, parsed.data);
  if (!saved) return notFound("BOM 行不存在或不属于当前租户");
  // PR-F:草稿/停用/淘汰的物料不得进入正式 BOM,拒绝并说明该做什么
  if ("blocked" in saved && saved.blocked) {
    return NextResponse.json({ error: saved.reason }, { status: 422 });
  }
  return NextResponse.json({ decision: saved });
}
