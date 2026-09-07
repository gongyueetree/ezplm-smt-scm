import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import {
  closeEcn,
  confirmCustomer,
  decideStage,
  releaseEcn,
  submitEcn,
  voidEcn,
} from "@/lib/server/repositories/ecn";

export const runtime = "nodejs";

const Input = z.object({
  action: z.enum(["submit", "approve", "reject", "customer-confirm", "release", "close", "void"]),
  comment: z.string().trim().max(1000).nullable().optional(),
});

/**
 * F2:状态动作。谁能做什么在仓储层判定(阶段角色/管理层门槛),
 * 全部写 AuditLog;退回与作废原因必填(域层校验)。
 */
export async function POST(req: Request, { params }: { params: Promise<{ ecnId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { ecnId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");
  const comment = parsed.data.comment ?? null;

  const r = await (async () => {
    switch (parsed.data.action) {
      case "submit":
        return submitEcn(auth.session, ecnId);
      case "approve":
        return decideStage(auth.session, ecnId, { decision: "APPROVED", comment });
      case "reject":
        return decideStage(auth.session, ecnId, { decision: "REJECTED", comment });
      case "customer-confirm":
        return confirmCustomer(auth.session, ecnId, comment);
      case "release":
        return releaseEcn(auth.session, ecnId);
      case "close":
        return closeEcn(auth.session, ecnId);
      case "void":
        return voidEcn(auth.session, ecnId, comment ?? "");
    }
  })();

  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json(r);
}
