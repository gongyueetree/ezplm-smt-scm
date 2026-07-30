import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { PO_STATUSES, type PoStatusValue } from "@/lib/domain/po-status";
import {
  materializeToOpo,
  transitionPurchaseOrder,
} from "@/lib/server/repositories/purchase-order";

export const runtime = "nodejs";

const Input = z.object({
  to: z.enum(PO_STATUSES),
  reason: z.string().trim().max(500).nullable().optional(),
  /** 审批通过后是否顺带生成在途行(OPOLine) */
  materializeOpo: z.boolean().optional(),
});

/**
 * PO 状态流转的唯一入口:提交复核 / 复核通过 / 终审 / 退回 / 作废 / 标记已导出。
 * 角色与原因校验由领域层状态机负责,这里只做参数校验与响应映射。
 */
export async function POST(req: Request, { params }: { params: Promise<{ poId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { poId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const result = await transitionPurchaseOrder(
    auth.session,
    poId,
    parsed.data.to as PoStatusValue,
    { reason: parsed.data.reason },
  );
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "forbidden_role" ? 403 : 422;
    return NextResponse.json(
      { error: result.message, code: result.code, unresolvedLines: result.unresolvedLines },
      { status },
    );
  }

  let opo: { created: number } | { error: string } | null = null;
  if (parsed.data.materializeOpo && parsed.data.to === "APPROVED") {
    const m = await materializeToOpo(auth.session, poId);
    opo = m.ok ? { created: m.created } : { error: m.reason };
  }

  return NextResponse.json({ status: result.status, opo });
}
