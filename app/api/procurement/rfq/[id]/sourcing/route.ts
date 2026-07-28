import { NextResponse } from "next/server";
import { buildComparisonSet } from "@/lib/domain/sourcing";
import { notFound, requireSession } from "@/lib/server/api";
import { loadSourcingLines, runSourcing } from "@/lib/server/repositories/procurement";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * 多源询价并构建比价集合(SPEC §11)。
 * 三方 + 线下 Excel 的报价统一为 NormalizedOffer 后进同一张比价表;
 * provider 失败只降级不阻断,degraded 如实返回给 UI。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const loaded = await loadSourcingLines(auth.session, id);
  if (!loaded) return notFound("采购 RFQ 不存在或不属于当前租户");
  const { prfq, lines } = loaded;

  // 线下供应商报价(已落库)一并进入比价集合
  const offlineLines = await prisma.supplierQuoteLine.findMany({
    where: tenantWhere(auth.session.tenantId, {
      supplierQuote: { procurementRfqId: id },
    }),
    include: { supplierQuote: { select: { supplierId: true, quotedAt: true } } },
  });

  const targets = lines.filter((l) => l.mpn);
  const results = [];
  const degradedAll: { provider: string; kind: string; message: string }[] = [];

  for (const line of targets.slice(0, 20)) {
    const demandQty = Number(line.qty) || 1;
    const run = await runSourcing(line.mpn!, line.manufacturer, demandQty);
    degradedAll.push(...run.degraded);

    const offline = offlineLines
      .filter((o) => o.mpn.toUpperCase() === line.mpn!.toUpperCase())
      .map((o) => ({
        provider: "OFFLINE" as const,
        providerPartNumber: o.id,
        manufacturer: o.manufacturer,
        mpn: o.mpn,
        description: null,
        packaging: null,
        stock: null,
        moq: o.moq === null ? null : Number(o.moq),
        spq: o.spq === null ? null : Number(o.spq),
        leadTimeDays: o.leadTimeDays,
        lifecycle: "UNKNOWN" as const,
        rohs: null,
        reach: null,
        currency: o.currency,
        priceBreaks: [{ minQty: 1, unitPrice: String(o.unitPrice) }],
        sourceUpdatedAt: o.quotedAt.toISOString(),
        sourceUrl: null,
        supplierId: o.supplierQuote.supplierId,
      }));

    const set = buildComparisonSet({
      mpn: line.mpn!,
      manufacturer: line.manufacturer,
      demandQty,
      currency: "CNY",
      mode: prfq.sourcingMode,
      offers: [...run.offers, ...offline],
    });

    results.push({
      bomLineId: line.id,
      mpn: line.mpn,
      manufacturer: line.manufacturer,
      demandQty,
      recommended: set.recommended,
      lowestTotal: set.lowestTotal,
      eligible: set.eligible,
      excluded: set.excluded,
      totalOffers: set.ranked.length,
    });
  }

  return NextResponse.json({
    procurementRfqId: id,
    mode: prfq.sourcingMode,
    truncated: targets.length > 20,
    results,
    degraded: degradedAll,
  });
}
