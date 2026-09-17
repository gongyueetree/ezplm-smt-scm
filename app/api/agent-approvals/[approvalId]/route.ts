import { NextResponse } from "next/server";
import { z } from "zod";
import type { CategorySuggestion } from "@/lib/agents/quote-agent";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { decideAgentApproval } from "@/lib/server/repositories/agent-run";
import { patchQuoteLinesInTx } from "@/lib/server/repositories/quote";

export const runtime = "nodejs";

const Input = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

/**
 * 人工对 Agent 写工具的确认卡片作出决定(SPEC §13)。
 * **批准后才执行实际写入**;拒绝则什么都不写。
 *
 * R0-6:此前只有 requireSession —— 任何已登录用户都能批准 AI 写入。
 * R0-4:写入改为**字段级 patch**,且与状态翻转同事务。
 */
export async function POST(req: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  // 守卫必须在查库之前 —— 无权者不应从 404/200 的差别里探到卡片是否存在
  const perm = await requirePermission(auth.session, "quote.agent.approve");
  if (!perm.ok) return perm.response;

  const { approvalId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  let missingLines: number[] = [];
  let appliedLines = 0;

  let decided;
  try {
    decided = await decideAgentApproval(
      auth.session,
      approvalId,
      parsed.data.decision,
      // R0-4:写入在**同一事务内**先执行 —— 抛错即整体回滚,卡片留在 PENDING 可重试
      async (tx, approval) => {
        const payload = approval.payload as {
          payload?: { versionId?: string; suggestions?: CategorySuggestion[] };
        };
        const versionId = payload?.payload?.versionId;
        const suggestions = payload?.payload?.suggestions ?? [];
        if (!versionId) throw new Error("确认卡片缺少目标报价版本");

        /*
         * 只 patch 分类与 Markup 两个**建议参数**。
         *
         * 金额一律不取 Agent 输出(CLAUDE.md 约束 2),由确定性函数在汇总时重算;
         * 而且绝不能用整行 upsert —— 那会把未提供的 qty / purchaseCost /
         * customerPrice / MPN / 备注一并置 null(R0-4 的缺陷现场)。
         */
        const res = await patchQuoteLinesInTx(
          tx,
          auth.session,
          versionId,
          suggestions.map((s) => ({
            lineNo: s.lineNo,
            patch: { materialCategory: s.materialCategory, markupPct: s.suggestedMarkupPct },
          })),
        );
        appliedLines = res.applied;
        missingLines = res.missing;
      },
    );
  } catch (e) {
    // 事务已回滚:卡片仍是 PENDING。如实把原因返回,不谎称已批准
    return NextResponse.json(
      { error: `批准未生效(已回滚,卡片仍待处理):${e instanceof Error ? e.message : String(e)}` },
      { status: 422 },
    );
  }

  if (!decided) return notFound("确认卡片不存在或不属于当前租户");
  if (decided.alreadyDecided) {
    return NextResponse.json({ error: "该确认卡片已处理过" }, { status: 422 });
  }

  if (parsed.data.decision === "REJECTED") {
    return NextResponse.json({ ok: true, applied: 0 });
  }

  return NextResponse.json({
    ok: missingLines.length === 0,
    applied: appliedLines,
    // 如实报出"提案里有、报价里没有"的行,而不是当作成功
    missingLines,
    // 诚实提示:写入的是分类与 Markup 建议,分类仍需逐行人工确认
    note: "已写入分类与 Markup 建议;物料分类仍需逐行人工确认后才能提交审批",
  });
}
