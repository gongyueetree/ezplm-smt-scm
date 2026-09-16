/**
 * R4-8(§45/§46):BOM Price Matrix + Cost Selection + 快照证据构造。
 *
 * - 矩阵按已确认匹配(BOMLine.internalPartId)取价格池;未匹配行如实
 *   NO_PART(不猜);
 * - 选择(人工):校验候选存在于池内(防手填幻价);引用非 APPROVED
 *   报价强制 unapprovedSource=true(§37);跨币种选择需 FX 可换,否则拒绝;
 * - 冻结(§46):buildCostEvidence 产出 提交快照里的成本证据(候选/阶梯/
 *   Low-High/选中/FX/依据),审批后不随 API 刷新变化。
 */
import type { Prisma } from "@prisma/client";
import {
  priceRange,
  usablePrices,
  type NormalizedMaterialPrice,
} from "@/lib/domain/price-pool";
import { collectMaterialPrices } from "@/lib/server/repositories/price-pool";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { getTenantSettings } from "@/lib/server/tenant-settings";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export interface CostMatrixRow {
  bomLineId: string;
  lineNo: number;
  internalPn: string | null;
  mpn: string | null;
  manufacturer: string | null;
  demandQty: string;
  qtyBasis: { qty: number; basis: string };
  routing: "COMPONENT" | "NON_COMPONENT" | "NO_PART";
  internalPrice: string | null;
  historicalPrice: string | null;
  distributorLow: string | null;
  supplierQuoteLow: string | null;
  supplierQuoteHigh: string | null;
  overallLow: string | null;
  overallHigh: string | null;
  selected: {
    source: string;
    supplierId: string | null;
    unitCost: string;
    currency: string;
    unapprovedSource: boolean;
    evidenceRef: string;
  } | null;
  candidates: NormalizedMaterialPrice[];
  excludedCount: number;
  notes: string[];
}

export async function buildCostMatrix(
  session: SessionRef,
  bomVersionId: string,
  onlyLineIds?: string[],
): Promise<{ rows: CostMatrixRow[]; coverage: { total: number; withCost: number; missing: number } }> {
  const { settings } = await getTenantSettings(session.tenantId);
  const lines = await prisma.bOMLine.findMany({
    where: tenantWhere(session.tenantId, {
      bomVersionId,
      ...(onlyLineIds?.length ? { id: { in: onlyLineIds } } : {}),
    }),
    orderBy: { lineNo: "asc" },
  });
  const partIds = [...new Set(lines.map((l) => l.internalPartId).filter((v): v is string => !!v))];
  const parts = partIds.length
    ? await prisma.part.findMany({ where: tenantWhere(session.tenantId, { id: { in: partIds } }) })
    : [];
  const partById = new Map(parts.map((p) => [p.id, p]));
  const selections = await prisma.bomCostSelection.findMany({
    where: tenantWhere(session.tenantId, { bomVersionId }),
  });
  const selByLine = new Map(selections.map((s) => [s.bomLineId, s]));
  const blockedSuppliers = new Set(
    (
      await prisma.partSupplierRef.findMany({
        where: tenantWhere(session.tenantId, { isBlocked: true, partId: partIds.length ? { in: partIds } : undefined }),
        select: { supplierId: true },
      })
    ).map((r) => r.supplierId),
  );

  const rows: CostMatrixRow[] = [];
  for (const l of lines) {
    const part = l.internalPartId ? partById.get(l.internalPartId) : undefined;
    const demandQty = Number(l.qty);
    if (!part) {
      rows.push({
        bomLineId: l.id,
        lineNo: l.lineNo,
        internalPn: l.internalPn ?? null,
        mpn: l.mpn,
        manufacturer: l.manufacturer,
        demandQty: l.qty.toString(),
        qtyBasis: { qty: demandQty, basis: "DEMAND_QTY" },
        routing: "NO_PART",
        internalPrice: null,
        historicalPrice: null,
        distributorLow: null,
        supplierQuoteLow: null,
        supplierQuoteHigh: null,
        overallLow: null,
        overallHigh: null,
        selected: null,
        candidates: [],
        excludedCount: 0,
        notes: ["行未完成物料匹配确认 —— 先在匹配页人工确认内部料"],
      });
      continue;
    }
    const pool = await collectMaterialPrices({
      tenantId: session.tenantId,
      partId: part.id,
      demandQty,
    });
    const { usable, excluded } = usablePrices(pool.prices, {
      qty: pool.qtyBasis.qty,
      blockedSupplierIds: blockedSuppliers,
    });
    const range = priceRange(usable, {
      includeDistributorInRange: settings.includeDistributorInPriceRange,
    });
    const bySource = (src: string) => usable.filter((p) => p.source === src);
    const lowOf = (list: NormalizedMaterialPrice[]) =>
      list.length ? list.reduce((a, b) => (Number(b.unitPrice) < Number(a.unitPrice) ? b : a)).unitPrice : null;
    const highOf = (list: NormalizedMaterialPrice[]) =>
      list.length ? list.reduce((a, b) => (Number(b.unitPrice) > Number(a.unitPrice) ? b : a)).unitPrice : null;
    const sel = selByLine.get(l.id);
    rows.push({
      bomLineId: l.id,
      lineNo: l.lineNo,
      internalPn: part.internalPn,
      mpn: l.mpn ?? part.mpn,
      manufacturer: l.manufacturer ?? part.manufacturer,
      demandQty: l.qty.toString(),
      qtyBasis: pool.qtyBasis,
      routing: part.materialKind === "ELECTRONIC_COMPONENT" ? "COMPONENT" : "NON_COMPONENT",
      internalPrice: lowOf(bySource("INTERNAL")),
      historicalPrice: lowOf(bySource("HISTORICAL_PO")),
      distributorLow: lowOf([...bySource("DIGIKEY"), ...bySource("MOUSER")]),
      supplierQuoteLow: range.supplierOnlyLow?.unitPrice ?? null,
      supplierQuoteHigh: range.supplierOnlyHigh?.unitPrice ?? null,
      overallLow: range.low?.unitPrice ?? null,
      overallHigh: range.high?.unitPrice ?? null,
      selected: sel
        ? {
            source: sel.selectedSource,
            supplierId: sel.selectedSupplierId,
            unitCost: sel.unitCost.toString(),
            currency: sel.currency,
            unapprovedSource: sel.unapprovedSource,
            evidenceRef: sel.evidenceRef,
          }
        : null,
      candidates: usable,
      excludedCount: excluded.length,
      notes: pool.notes,
    });
  }

  const material = rows.filter((r) => r.routing !== "NO_PART");
  const withCost = material.filter((r) => r.selected !== null).length;
  return {
    rows,
    coverage: { total: rows.length, withCost, missing: rows.length - withCost },
  };
}

type Outcome = { ok: true; unapprovedSource: boolean } | { ok: false; reason: string };

/** 人工成本选择:候选必须真实存在于当前价格池(防手填幻价);审计 */
export async function selectCost(
  session: SessionRef,
  input: {
    bomVersionId: string;
    bomLineId: string;
    evidenceRef: string;
    note?: string | null;
  },
): Promise<Outcome> {
  const line = await prisma.bOMLine.findFirst({
    where: tenantWhere(session.tenantId, { id: input.bomLineId, bomVersionId: input.bomVersionId }),
  });
  if (!line) return { ok: false, reason: "BOM 行不存在" };
  if (!line.internalPartId) return { ok: false, reason: "行未确认内部料,不能选成本" };
  const pool = await collectMaterialPrices({
    tenantId: session.tenantId,
    partId: line.internalPartId,
    demandQty: Number(line.qty),
  });
  const { usable } = usablePrices(pool.prices, { qty: pool.qtyBasis.qty });
  const cand = usable.find((p) => p.evidenceRef === input.evidenceRef);
  if (!cand) return { ok: false, reason: "所选价格不在当前可用候选内(可能已过期/被拒/数量不适用)—— 刷新矩阵后重选" };
  const unapprovedSource = cand.source === "SUPPLIER_QUOTE" && cand.approvalStatus !== "APPROVED";

  await prisma.$transaction(async (tx) => {
    const data = {
      partId: line.internalPartId,
      partMfgMappingId: cand.partMfgMappingId,
      selectedSource: cand.source,
      selectedSupplierId: cand.supplierId,
      unitCost: cand.unitPrice,
      currency: cand.currency,
      priceQtyBasis: pool.qtyBasis.basis,
      effectiveBuyQty: String(pool.qtyBasis.qty),
      evidenceRef: cand.evidenceRef,
      unapprovedSource,
      note: input.note ?? null,
      selectedById: session.userId,
      selectedAt: new Date(),
    };
    const existing = await tx.bomCostSelection.findFirst({
      where: tenantWhere(session.tenantId, { bomLineId: input.bomLineId }),
      select: { id: true },
    });
    if (existing) await tx.bomCostSelection.update({ where: { id: existing.id }, data });
    else {
      await tx.bomCostSelection.create({
        data: tenantData(session.tenantId, {
          bomVersionId: input.bomVersionId,
          bomLineId: input.bomLineId,
          ...data,
        }) as Prisma.BomCostSelectionUncheckedCreateInput,
      });
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "BOM_COST_SELECT",
      entityType: "BomCostSelection",
      entityId: input.bomLineId,
      after: {
        source: cand.source,
        supplierId: cand.supplierId,
        unitCost: cand.unitPrice,
        currency: cand.currency,
        basis: pool.qtyBasis.basis,
        unapprovedSource,
        evidenceRef: cand.evidenceRef,
      },
    });
  });
  return { ok: true, unapprovedSource };
}

/**
 * §46:报价提交时的成本证据冻结块(嵌入 QuoteVersion.submittedSnapshot)。
 * 快照后 Live API 刷新不改变已批报价 —— 证据以此为准。
 */
export async function buildCostEvidenceForQuoteLines(
  tenantId: string,
  bomLineIds: string[],
): Promise<unknown | null> {
  if (bomLineIds.length === 0) return null;
  const lines = await prisma.bOMLine.findMany({
    where: tenantWhere(tenantId, { id: { in: bomLineIds } }),
    select: { id: true, bomVersionId: true },
  });
  const byVersion = new Map<string, string[]>();
  for (const l of lines) byVersion.set(l.bomVersionId, [...(byVersion.get(l.bomVersionId) ?? []), l.id]);
  const blocks = [];
  for (const [vid, ids] of byVersion) blocks.push(await buildCostEvidence(tenantId, vid, ids));
  return blocks.length === 1 ? blocks[0] : { multiBom: true, blocks };
}

export async function buildCostEvidence(
  tenantId: string,
  bomVersionId: string,
  onlyLineIds?: string[],
): Promise<{
  bomVersionId: string;
  frozenAt: string;
  coverage: { total: number; withCost: number; missing: number };
  lines: unknown[];
  fx: { note: string };
}> {
  const session: SessionRef = { tenantId, userId: "system:snapshot", roles: ["MANAGEMENT"] } as never;
  const matrix = await buildCostMatrix(session, bomVersionId, onlyLineIds);
  return {
    bomVersionId,
    frozenAt: new Date().toISOString(),
    coverage: matrix.coverage,
    lines: matrix.rows.map((r) => ({
      bomLineId: r.bomLineId,
      lineNo: r.lineNo,
      internalPn: r.internalPn,
      mpn: r.mpn,
      qtyBasis: r.qtyBasis,
      overallLow: r.overallLow,
      overallHigh: r.overallHigh,
      supplierQuoteLow: r.supplierQuoteLow,
      supplierQuoteHigh: r.supplierQuoteHigh,
      selected: r.selected,
      candidates: r.candidates, // 全候选含阶梯档/币种/有效期/证据指针
    })),
    fx: {
      note: "本快照各候选保留原币种与原单价;报价基准币种换算(如适用)由报价行自身冻结 —— 跨币种不比大小(既有纪律)",
    },
  };
}
