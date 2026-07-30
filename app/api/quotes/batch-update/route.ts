import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { runQuoteBatchUpdate } from "@/lib/server/repositories/quote-batch-update";

export const runtime = "nodejs";

const Input = z.object({ bomVersionIds: z.array(z.string().min(1)).min(1).max(50) });

/** 批量 update 报价:已有报价开新 Revision,没有则新建;逐 BOM 独立成败 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PM" || r === "MANAGEMENT")) {
    return forbidden("仅 PM 或管理层可批量生成报价");
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法(一次最多 50 个 BOM 版本)");

  const { jobId, results } = await runQuoteBatchUpdate(auth.session, parsed.data.bomVersionIds);
  return NextResponse.json({
    jobId,
    results,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  });
}
