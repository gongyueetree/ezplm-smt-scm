import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import {
  listAnalysisRuns,
  queryTraceScoped,
  saveAnalysisRun,
} from "@/lib/server/repositories/traceability";

export const runtime = "nodejs";

/** 历史分析台账 —— 不必每次重算 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "trace.view");
  if (!perm.ok) return perm.response;

  const sourceRef = new URL(req.url).searchParams.get("sourceRef") ?? undefined;
  return NextResponse.json({ runs: await listAnalysisRuns(auth.session, sourceRef) });
}

const Input = z.object({
  sourceRef: z.string().trim().min(1).max(200),
  incidentId: z.string().trim().nullable().optional(),
});

/**
 * 固化一次影响面分析。
 *
 * 异常调查持续数周,期间图数据一直在变;不存快照,
 * 事后说不清"当时是按什么数据下的隔离决定"。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "trace.analyze");
  if (!perm.ok) return perm.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const q = await queryTraceScoped(auth.session, parsed.data.sourceRef);
  if (!q.ok) return NextResponse.json({ error: q.reason }, { status: 422 });

  const saved = await saveAnalysisRun(auth.session, {
    sourceRef: parsed.data.sourceRef,
    result: q.result,
    incidentId: parsed.data.incidentId,
  });

  return NextResponse.json(
    {
      id: saved.id,
      confidence: q.result.coverage.confidence,
      coverageScore: q.result.coverage.score,
      caveat: q.result.conclusionCaveat,
    },
    { status: 201 },
  );
}
