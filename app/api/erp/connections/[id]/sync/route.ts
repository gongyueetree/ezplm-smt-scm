import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { runSync } from "@/lib/server/repositories/erp-sync";

export const runtime = "nodejs";

const Input = z.object({
  entityType: z.enum(["MATERIAL", "INVENTORY", "OPEN_PO", "WORK_ORDER", "PURCHASE_ORDER", "ETA_WRITEBACK", "RECEIPT_LOT", "SHIPMENT"]),
  mode: z.enum(["PREVIEW", "EXECUTE"]).default("PREVIEW"),
});

/** 预览与执行同一入口;**预览不写业务表**,执行受冲突策略与映射完整性双重把关 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const perm = await requirePermission(
    auth.session,
    parsed.data.mode === "EXECUTE" ? "erp.sync.execute" : "erp.sync.preview",
  );
  if (!perm.ok) return perm.response;

  const { id } = await params;
  const r = await runSync(auth.session, {
    connectionId: id,
    entityType: parsed.data.entityType,
    mode: parsed.data.mode,
  });
  if (!r.ok) {
    const status = r.code === "not_found" ? 404 : r.code === "not_ready" ? 501 : 422;
    return NextResponse.json({ error: r.reason, code: r.code }, { status });
  }
  return NextResponse.json(r);
}
