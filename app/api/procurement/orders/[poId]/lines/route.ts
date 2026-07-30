import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { replaceLines } from "@/lib/server/repositories/purchase-order";

export const runtime = "nodejs";

const LineSchema = z.object({
  lineNo: z.number().int().positive(),
  mpn: z.string().trim().max(100).nullable().optional(),
  manufacturer: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  qty: z.string().min(1),
  unitPrice: z.string().nullable().optional(),
  currency: z.string().trim().length(3).nullable().optional(),
  moq: z.number().int().nonnegative().nullable().optional(),
  spq: z.number().int().nonnegative().nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  requestDate: z.string().nullable().optional(),
  sourcingMode: z.enum(["SPOT", "FUTURES"]).nullable().optional(),
});

/** 批量录入 / 整份替换行项;冻结态会被拒(422) */
export async function PUT(req: Request, { params }: { params: Promise<{ poId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可修改采购订单行");
  }
  const { poId } = await params;
  const parsed = z
    .object({ lines: z.array(LineSchema).min(1).max(500) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const result = await replaceLines(auth.session, poId, parsed.data.lines);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });
  return NextResponse.json({ count: result.count });
}
