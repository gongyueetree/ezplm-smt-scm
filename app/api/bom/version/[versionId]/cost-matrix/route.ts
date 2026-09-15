import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { buildCostMatrix, selectCost } from "@/lib/server/repositories/cost-matrix";

export const runtime = "nodejs";

const can = (roles: readonly string[]) =>
  roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT" || r === "PM");

/** R4-8(§45):BOM 价格矩阵(每行 Internal/Historical/Distributor/Supplier Low-High/Overall/Selected + 展开候选) */
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!can(auth.session.roles)) return forbidden("成本矩阵属采购/PM/管理层");
  const { versionId } = await params;
  const matrix = await buildCostMatrix(auth.session, versionId);
  return NextResponse.json(matrix);
}

const SelectInput = z.object({
  bomLineId: z.string().min(1),
  /** 池内候选的证据指针(evidenceRef)—— 只能选池里真实存在的价 */
  evidenceRef: z.string().min(1),
  note: z.string().max(500).nullable().optional(),
});

/** R4-8(§45/§46):人工成本选择(选中即留证据;引用未审批报价强制打 UNAPPROVED_SOURCE) */
export async function PUT(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!can(auth.session.roles)) return forbidden("成本选择属采购/PM/管理层");
  const { versionId } = await params;
  const parsed = SelectInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");
  const r = await selectCost(auth.session, { bomVersionId: versionId, ...parsed.data });
  if (!r.ok) return badRequest(r.reason);
  return NextResponse.json({ ok: true, unapprovedSource: r.unapprovedSource });
}
