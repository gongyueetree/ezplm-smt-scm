import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { proposeContainment } from "@/lib/server/repositories/traceability";

export const runtime = "nodejs";

const KINDS = [
  "FREEZE_LOT", "PAUSE_WORK_ORDER", "MARK_RECHECK", "DRAFT_RMA",
  "NOTIFY_SUPPLIER", "NOTIFY_CUSTOMER", "CREATE_CAPA",
  "RECALL_ASSESSMENT", "EXPORT_QUARANTINE_LIST",
] as const;

const Input = z.object({
  actions: z
    .array(
      z.object({
        kind: z.enum(KINDS),
        targetRef: z.string().trim().min(1).max(120),
        note: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});

/** 提议处置:**只登记建议,不执行任何操作**,需批准后才落本系统标记 */
export async function POST(req: Request, { params }: { params: Promise<{ incidentId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "trace.containment.propose");
  if (!perm.ok) return perm.response;

  const { incidentId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const ids = await proposeContainment(auth.session, incidentId, parsed.data.actions);
  return NextResponse.json(
    {
      ids,
      note: "已登记为待审批建议 —— 本系统尚未执行任何冻结/停线/通知动作",
    },
    { status: 201 },
  );
}
