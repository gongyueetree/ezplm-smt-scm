import { NextResponse } from "next/server";
import { notFound, requireSession } from "@/lib/server/api";
import { processNextBatch } from "@/lib/server/repositories/bom-import";

export const runtime = "nodejs";

/**
 * 轮询式进度:每次调用处理一批(10–20 行)后返回进度。
 * 拉取式设计:Serverless 无常驻后台,由前端持续拉取推进,
 * 单次请求绝不处理整张 BOM(SPEC §15)。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { jobId } = await params;

  const outcome = await processNextBatch(auth.session, jobId);
  if (!outcome) return notFound("导入作业不存在或不属于当前租户");
  return NextResponse.json(outcome);
}
