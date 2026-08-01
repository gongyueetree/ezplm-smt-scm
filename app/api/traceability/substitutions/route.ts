import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { recordSubstitution } from "@/lib/server/repositories/traceability";

export const runtime = "nodejs";

const Input = z.object({
  workOrderNo: z.string().trim().min(1).max(60),
  bomMpn: z.string().trim().max(100).nullable().optional(),
  actualMpn: z.string().trim().max(100).nullable().optional(),
  actualLotNo: z.string().trim().max(60).nullable().optional(),
  quantity: z.string().nullable().optional(),
  uom: z.string().trim().max(20).nullable().optional(),
  approvedById: z.string().trim().nullable().optional(),
  approvalReason: z.string().trim().max(300).nullable().optional(),
  approvedAt: z.string().nullable().optional(),
});

/**
 * 登记生产替代料实际使用。
 *
 * **不改动 BOM**:BOM 记"设计要什么",本表记"实际投了什么"。
 * 无批准人的替代会在响应里显式警示,而不是静默接受。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "trace.import");
  if (!perm.ok) return perm.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const r = await recordSubstitution(auth.session, parsed.data);
  return NextResponse.json({ id: r.id, warning: r.warning }, { status: 201 });
}
