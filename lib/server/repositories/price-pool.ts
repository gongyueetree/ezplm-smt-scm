/**
 * R4-6(§39):Price Pool 聚合 —— 不建平行总表,现场聚合既有来源:
 * INTERNAL(PartSupplierRef.referencePrice / Part.standardCost)
 * SUPPLIER_QUOTE(SupplierOffer + PriceBreak,按 effective buy qty 先选档再进池)
 * DIGIKEY / MOUSER(缓存/实时 provider,可选)
 * HISTORICAL_PO(§51:待 R4-9 ERP PO 落库后接入 —— 当前如实空集 + note)
 *
 * 数量口径(§44):Price Qty Basis(Selected>Suggested>Demand)→
 * 复用采购已有 calculateRoundedPurchaseQty 做 MOQ/SPQ 圆整 → 选档。
 */
import {
  calculateRoundedPurchaseQty,
  getApplicablePriceBreak,
} from "@/lib/domain/offers";
import {
  priceQtyBasis,
  type NormalizedMaterialPrice,
} from "@/lib/domain/price-pool";
import { prisma } from "@/lib/server/db";
import { mfgPartNoKey } from "@/lib/domain/part-mfg";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface PricePoolQuery {
  tenantId: string;
  partId?: string | null;
  internalPn?: string | null;
  mpn?: string | null;
  demandQty: number;
  selectedBuyQty?: number | null;
  suggestedBuyQty?: number | null;
}

export interface PricePoolResult {
  qtyBasis: ReturnType<typeof priceQtyBasis>;
  prices: NormalizedMaterialPrice[];
  notes: string[];
}

export async function collectMaterialPrices(q: PricePoolQuery): Promise<PricePoolResult> {
  const basis = priceQtyBasis(q);
  const notes: string[] = [];
  const prices: NormalizedMaterialPrice[] = [];

  const part = q.partId
    ? await prisma.part.findFirst({ where: tenantWhere(q.tenantId, { id: q.partId }) })
    : q.internalPn
      ? await prisma.part.findFirst({ where: tenantWhere(q.tenantId, { internalPn: q.internalPn }) })
      : null;

  // ---- INTERNAL:标准成本 + 供应商预设参考价(仅初始参考,如实标注) ----
  if (part?.standardCost) {
    prices.push({
      source: "INTERNAL",
      supplierId: null,
      provider: null,
      partId: part.id,
      partMfgMappingId: null,
      internalPn: part.internalPn,
      canonicalManufacturerId: null,
      manufacturer: part.manufacturer,
      mpn: part.mpn,
      currency: part.standardCostCurrency ?? "CNY",
      unitPrice: part.standardCost.toString(),
      minQty: "1",
      maxQty: null,
      moq: null,
      spq: null,
      leadTimeDays: null,
      quotedAt: null,
      validUntil: null,
      sourceUpdatedAt: part.updatedAt.toISOString(),
      evidenceRef: `Part.standardCost:${part.id}`,
      approvalStatus: null,
    });
  }
  if (part) {
    const refs = await prisma.partSupplierRef.findMany({
      where: tenantWhere(q.tenantId, { partId: part.id, referencePrice: { not: null } }),
    });
    for (const r of refs) {
      prices.push({
        source: "INTERNAL",
        supplierId: r.supplierId,
        provider: null,
        partId: part.id,
        partMfgMappingId: r.partMfgMappingId,
        internalPn: part.internalPn,
        canonicalManufacturerId: null,
        manufacturer: null,
        mpn: null,
        currency: r.currency,
        unitPrice: r.referencePrice!.toString(),
        minQty: "1",
        maxQty: null,
        moq: r.moq?.toString() ?? null,
        spq: r.spq?.toString() ?? null,
        leadTimeDays: r.leadTimeDays,
        quotedAt: null,
        validUntil: null,
        sourceUpdatedAt: r.updatedAt.toISOString(),
        evidenceRef: `PartSupplierRef:${r.id}(参考价,非正式报价)`,
        approvalStatus: null,
      });
    }
  }

  // ---- SUPPLIER_QUOTE:SupplierOffer + PriceBreak(先按 effective qty 选档) ----
  // 候选 MPN 原文集(定向 IN 查询,§32:不做全表扫);
  // 归一键兜底靠 mapping 的原样 manufacturerPartNo(offer 的 MPN 来自
  // 同一 RFQ/映射链路,原文一致性高)
  const rawMpns = new Set<string>();
  if (q.mpn) rawMpns.add(q.mpn);
  if (part) {
    const mappings = await prisma.partMfgMapping.findMany({
      where: tenantWhere(q.tenantId, {
        partId: part.id,
        status: { in: ["CANDIDATE", "APPROVED"] as never[] },
        identifierMatchMode: "EXACT" as const,
      }),
      select: { manufacturerPartNo: true },
    });
    for (const m of mappings) rawMpns.add(m.manufacturerPartNo);
    if (part.mpn) rawMpns.add(part.mpn);
  }
  if (rawMpns.size > 0) {
    const mpnKeys = new Set([...rawMpns].map((v) => mfgPartNoKey(v)));
    const wanted = (
      await prisma.supplierOffer.findMany({
        where: tenantWhere(q.tenantId, { mpn: { in: [...rawMpns], mode: "insensitive" as const } }),
        include: { priceBreaks: { orderBy: { minQty: "asc" } } },
        orderBy: { createdAt: "desc" },
      })
    ).filter((o) => mpnKeys.has(mfgPartNoKey(o.mpn)));
    for (const o of wanted) {
      const eff = calculateRoundedPurchaseQty(basis.qty, {
        moq: o.moq ? Number(o.moq) : undefined,
        spq: o.spq ? Number(o.spq) : undefined,
      });
      const pb = getApplicablePriceBreak(
        o.priceBreaks.map((b) => ({ minQty: Number(b.minQty), unitPrice: b.unitPrice.toString() })),
        eff,
      );
      if (!pb) continue; // 数量不适用:usablePrices 层还会兜一道,这里先不进池
      prices.push({
        source: "SUPPLIER_QUOTE",
        supplierId: o.supplierId,
        provider: o.provider,
        partId: part?.id ?? null,
        partMfgMappingId: null,
        internalPn: part?.internalPn ?? q.internalPn ?? null,
        canonicalManufacturerId: null,
        manufacturer: o.manufacturer,
        mpn: o.mpn,
        currency: o.currency,
        unitPrice: pb.unitPrice.toString(),
        minQty: String(pb.minQty),
        maxQty: null,
        moq: o.moq?.toString() ?? null,
        spq: o.spq?.toString() ?? null,
        leadTimeDays: o.leadTimeDays,
        quotedAt: o.sourceUpdatedAt?.toISOString() ?? o.createdAt.toISOString(),
        validUntil: o.validUntil?.toISOString() ?? null,
        sourceUpdatedAt: o.sourceUpdatedAt?.toISOString() ?? null,
        evidenceRef: `SupplierOffer:${o.id}`,
        approvalStatus: o.status,
      });
    }
  }

  // ---- HISTORICAL_PO(§51):R4-9 ERP PO 落库后接入 ----
  notes.push("HISTORICAL_PO 来源待 R4-9(ERP PO 单据落库)接入 —— 当前不提供历史采购价,不用假数据");

  return { qtyBasis: basis, prices, notes };
}
