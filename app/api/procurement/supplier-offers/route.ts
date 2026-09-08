import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { upsertSupplierOffer } from "@/lib/server/repositories/procurement";
import { tenantWhere } from "@/lib/server/tenant-scope";

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

/**
 * R3-4:线下报价池查询(采购视角)。免登录报价链接落进来的 SupplierOffer
 * 从这里可见 —— 没有读路径的落库等于黑洞。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可查看报价池");
  }
  const url = new URL(req.url);
  const mpn = url.searchParams.get("mpn");
  const supplierId = url.searchParams.get("supplierId");
  const offers = await prisma.supplierOffer.findMany({
    where: tenantWhere(auth.session.tenantId, {
      ...(mpn ? { mpn: { equals: mpn, mode: "insensitive" as const } } : {}),
      ...(supplierId ? { supplierId } : {}),
    }),
    include: { priceBreaks: { orderBy: { minQty: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    offers: offers.map((o) => ({
      id: o.id,
      provider: o.provider,
      supplierId: o.supplierId,
      mpn: o.mpn,
      currency: o.currency,
      moq: o.moq?.toString() ?? null,
      spq: o.spq?.toString() ?? null,
      leadTimeDays: o.leadTimeDays,
      validUntil: o.validUntil ? o.validUntil.toISOString().slice(0, 10) : null,
      supplierNote: o.supplierNote,
      priceBreaks: o.priceBreaks.map((b) => ({ minQty: b.minQty.toString(), unitPrice: b.unitPrice.toString() })),
      createdAt: o.createdAt.toISOString(),
    })),
  });
}
