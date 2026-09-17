import { NextResponse } from "next/server";
import { getQuoteAgent } from "@/lib/agents/quote-agent";
import { notFound, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { persistAgentRun } from "@/lib/server/repositories/agent-run";
import { getQuoteVersion } from "@/lib/server/repositories/quote";

export const runtime = "nodejs";

/**
 * 运行 QuoteAgent(SPEC §13)。
 * 读工具自动执行;写操作只产出待确认卡片(AgentApproval=PENDING),
 * 本接口**不写任何报价数据**。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  // R0-6:此前只有 requireSession —— 任何已登录用户都能触发外部模型调用(有成本)
  const perm = await requirePermission(auth.session, "quote.agent.run");
  if (!perm.ok) return perm.response;
  const { versionId } = await params;

  const version = await getQuoteVersion(auth.session, versionId);
  if (!version) return notFound("报价版本不存在或不属于当前租户");

  const agent = getQuoteAgent();
  const result = await agent.run({
    versionId,
    currency: version.currency,
    lines: version.lines.map((l) => ({
      lineNo: l.lineNo,
      mpn: l.quotedMpn,
      manufacturer: l.quotedMfg,
      description: l.note,
      qty: Number(l.qty ?? 0),
      purchaseCost: l.purchaseCost === null ? null : String(l.purchaseCost),
    })),
  });

  const run = await persistAgentRun(auth.session, result);
  return NextResponse.json({
    runId: run.id,
    mode: agent.mode,
    output: result.output,
    steps: result.steps.length,
    pendingApprovals: result.writeProposals.length,
  });
}
