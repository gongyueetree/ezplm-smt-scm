import { NextResponse } from "next/server";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import {
  applicableStrategies,
  recommendSuppliers,
  type SupplierPriceFact,
  type SupplierStrategyRow,
} from "@/lib/domain/supplier-strategy";
import { priceFreshness, usablePrices } from "@/lib/domain/price-pool";
import { collectMaterialPrices } from "@/lib/server/repositories/price-pool";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * R4-6(§40):供应商推荐 —— 策略 × 价格池 → recommendationScore + reasons。
 * 推荐 ≠ 采购决定:本端点只读,不写任何选择。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT" || r === "PM")) {
    return forbidden("供应商推荐属采购/PM/管理层");
  }
  const url = new URL(req.url);
  const partId = url.searchParams.get("partId");
  const qty = Number(url.searchParams.get("qty") ?? "0");
  const mfgMappingId = url.searchParams.get("partMfgMappingId");
  if (!partId || !Number.isFinite(qty) || qty <= 0) return badRequest("需要 partId 与正数 qty");

  const [refs, suppliers, pool] = await Promise.all([
    prisma.partSupplierRef.findMany({ where: tenantWhere(auth.session.tenantId, { partId }) }),
    prisma.supplier.findMany({
      where: tenantWhere(auth.session.tenantId, {}),
      select: { id: true, name: true, code: true },
    }),
    collectMaterialPrices({ tenantId: auth.session.tenantId, partId, demandQty: qty }),
  ]);
  const nameOf = new Map(suppliers.map((s) => [s.id, `${s.name}(${s.code})`]));

  const strategyRows: SupplierStrategyRow[] = refs.map((r) => ({
    supplierId: r.supplierId,
    supplierName: nameOf.get(r.supplierId) ?? r.supplierId,
    partMfgMappingId: r.partMfgMappingId,
    priority: r.priority,
    isPreferred: r.isPreferred,
    isApproved: r.isApproved,
    isBlocked: r.isBlocked,
    moq: r.moq?.toString() ?? null,
    spq: r.spq?.toString() ?? null,
    leadTimeDays: r.leadTimeDays,
    allocationPercent: r.allocationPercent?.toString() ?? null,
    effectiveFrom: r.effectiveFrom?.toISOString() ?? null,
    effectiveTo: r.effectiveTo?.toISOString() ?? null,
    note: r.note,
  }));
  const strategies = applicableStrategies(strategyRows, mfgMappingId ?? null);

  const blocked = new Set(strategyRows.filter((r) => r.isBlocked).map((r) => r.supplierId));
  const { usable } = usablePrices(pool.prices, { qty, blockedSupplierIds: blocked });
  const facts = new Map<string, SupplierPriceFact>();
  for (const p of usable) {
    if (!p.supplierId) continue;
    const prev = facts.get(p.supplierId);
    if (prev && Number(prev.unitPrice ?? Infinity) <= Number(p.unitPrice)) continue;
    facts.set(p.supplierId, {
      supplierId: p.supplierId,
      unitPrice: p.unitPrice,
      currency: p.currency,
      expired: priceFreshness(p) === "EXPIRED",
      exactMfgSupport: !!mfgMappingId && p.partMfgMappingId === mfgMappingId,
      moq: p.moq,
      leadTimeDays: p.leadTimeDays,
      hasHistory: false, // §51:历史成交关系待 R4-9 ERP PO 落库后点亮
    });
  }

  const recommendations = recommendSuppliers(strategies, facts, { qty });
  return NextResponse.json({
    qtyBasis: pool.qtyBasis,
    recommendations,
    notes: [...pool.notes, "推荐仅供排序参考 —— 正式供应商选择必须人工确认(§40)"],
  });
}
