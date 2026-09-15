import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { listSupplierLines, setSupplierLines } from "@/lib/server/repositories/rfq-supplier";

export const runtime = "nodejs";

const can = (roles: readonly string[]) => roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT");

/** R4-7(§41):RFQ 的供应商行清单(全部供应商) */
export async function GET(_req: Request, { params }: { params: Promise<{ prfqId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!can(auth.session.roles)) return forbidden("询价行清单属采购/管理层");
  const { prfqId } = await params;
  const lines = await listSupplierLines(auth.session, prfqId);
  return NextResponse.json({
    lines: lines.map((l) => ({
      id: l.id,
      supplierId: l.supplierId,
      internalPn: l.internalPn,
      mpn: l.mpn,
      manufacturer: l.manufacturer,
      description: l.description,
      requestedQty: l.requestedQty.toString(),
    })),
  });
}

const Input = z.object({
  supplierId: z.string().min(1),
  lines: z
    .array(
      z.object({
        partId: z.string().nullable().optional(),
        internalPn: z.string().max(120).nullable().optional(),
        mpn: z.string().max(120).nullable().optional(),
        manufacturer: z.string().max(120).nullable().optional(),
        description: z.string().max(500).nullable().optional(),
        requestedQty: z.string().regex(/^\d+(\.\d+)?$/),
      }),
    )
    .min(1)
    .max(1000),
});

/** R4-7(§41):覆盖式设置某供应商的行清单(同一行可发给多家 —— 分别调用即可) */
export async function POST(req: Request, { params }: { params: Promise<{ prfqId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!can(auth.session.roles)) return forbidden("询价行清单属采购/管理层");
  const { prfqId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");
  const r = await setSupplierLines(auth.session, prfqId, parsed.data.supplierId, parsed.data.lines);
  if (!r.ok) return badRequest(r.reason);
  return NextResponse.json({ ok: true, count: r.count });
}
