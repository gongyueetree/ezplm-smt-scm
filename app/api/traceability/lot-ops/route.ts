import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { recordLotSplitMerge } from "@/lib/server/repositories/traceability";

export const runtime = "nodejs";

const Input = z.object({
  kind: z.enum(["SPLIT", "MERGE"]),
  sourceLotNos: z.array(z.string().trim().min(1)).min(1).max(200),
  targetLotNos: z.array(z.string().trim().min(1)).min(1).max(200),
  quantities: z.array(z.string()).max(200).optional(),
  uom: z.string().trim().max(20).nullable().optional(),
  reason: z.string().trim().max(300).nullable().optional(),
  operator: z.string().trim().max(60).nullable().optional(),
  occurredAt: z.string().nullable().optional(),
});

/**
 * 批次拆分 / 合并登记。
 *
 * 同时补图边 —— 只写记录不写边,追溯会在拆分处断掉,
 * 而客户投诉的往往正是拆出去的那一小批。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "trace.import");
  if (!perm.ok) return perm.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const r = await recordLotSplitMerge(auth.session, parsed.data);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json({ id: r.id, edgesCreated: r.edges }, { status: 201 });
}
