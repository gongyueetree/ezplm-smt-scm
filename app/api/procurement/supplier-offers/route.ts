import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { upsertSupplierOffer } from "@/lib/server/repositories/procurement";

export const runtime = "nodejs";

const Input = z.object({
  supplierId: z.string().min(1),
  mpn: z.string().min(1),
  manufacturer: z.string().nullable().optional(),
  currency: z.string().length(3),
  moq: z.number().int().nonnegative().nullable().optional(),
  spq: z.number().int().nonnegative().nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  priceBreaks: z
    .array(z.object({ minQty: z.number().int().nonnegative(), unitPrice: z.string() }))
    .min(1),
});

/** 供应商预设基础数据(Backlog B2:MOQ/LT/多阶价格) */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可维护供应商预设");
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const offer = await upsertSupplierOffer(auth.session, parsed.data);
  return NextResponse.json({ offer }, { status: 201 });
}
