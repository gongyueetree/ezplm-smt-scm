import { NextResponse } from "next/server";
import { z } from "zod";
import type { CategorySuggestion } from "@/lib/agents/quote-agent";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { decideAgentApproval } from "@/lib/server/repositories/agent-run";
import { upsertQuoteLine } from "@/lib/server/repositories/quote";

export const runtime = "nodejs";

const Input = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

/**
 * 人工对 Agent 写工具的确认卡片作出决定(SPEC §13)。
 * **批准后才由本接口执行实际写入**;拒绝则什么都不写。
 */
export async function POST(req: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { approvalId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  const decided = await decideAgentApproval(auth.session, approvalId, parsed.data.decision);
  if (!decided) return notFound("确认卡片不存在或不属于当前租户");
  if (decided.alreadyDecided) {
    return NextResponse.json({ error: "该确认卡片已处理过" }, { status: 422 });
  }

  if (parsed.data.decision === "REJECTED") {
    return NextResponse.json({ ok: true, applied: 0 });
  }

  // 批准 → 执行写入。金额不取 Agent 输出,只取"建议参数",由确定性函数在汇总时重算
  const payload = decided.approval.payload as {
    payload?: { versionId?: string; suggestions?: CategorySuggestion[] };
  };
  const versionId = payload?.payload?.versionId;
  const suggestions = payload?.payload?.suggestions ?? [];
  if (!versionId) return badRequest("确认卡片缺少目标报价版本");

  let applied = 0;
  const rejected: { lineNo: number; message: string }[] = [];
  for (const s of suggestions) {
    const r = await upsertQuoteLine(auth.session, versionId, {
      lineNo: s.lineNo,
      category: "MATERIAL",
      materialCategory: s.materialCategory,
      markupPct: s.suggestedMarkupPct,
    });
    if (r.ok) applied += 1;
    else rejected.push({ lineNo: s.lineNo, message: r.message });
  }

  return NextResponse.json({
    ok: rejected.length === 0,
    applied,
    rejected,
    // 诚实提示:写入的是分类与 Markup 建议,分类仍需逐行人工确认
    note: "已写入分类与 Markup 建议;物料分类仍需逐行人工确认后才能提交审批",
  });
}
