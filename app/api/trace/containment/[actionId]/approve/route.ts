import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { approveContainment } from "@/lib/server/repositories/traceability";

export const runtime = "nodejs";

const Input = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ actionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "trace.containment.approve");
  if (!perm.ok) return perm.response;

  const { actionId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const r = await approveContainment(auth.session, actionId, parsed.data.decision, parsed.data.reason);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json({
    state: r.state,
    note:
      r.state === "REGISTERED_LOCALLY"
        ? "**本系统已登记**;ERP/WMS 回写待执行,MES 联动未接入 —— 不代表产线或 ERP 已实际冻结"
        : null,
  });
}
