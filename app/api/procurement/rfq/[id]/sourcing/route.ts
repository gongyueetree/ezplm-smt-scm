import { NextResponse } from "next/server";
import { buildComparisonSet } from "@/lib/domain/sourcing";
import { computeProgress, nextBatchSlice } from "@/lib/domain/import-batching";
import { notFound, requireSession } from "@/lib/server/api";
import { loadSourcingLines, runSourcing } from "@/lib/server/repositories/procurement";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * 多源询价并构建比价集合(SPEC §11 + Backlog B4:分批)。
 *
 * 拉取式分批(与 BOM 导入同一模型):每次只处理一批(10–20 个料号)后立即返回进度,
 * 由前端持续拉取直至 done —— 既不在单个请求里打满三方配额、不触发 Serverless 超时,
 * 也不再像此前那样**静默截断到前 20 个料号**。
 * provider 失败只降级不阻断,degraded 如实返回给 UI。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const loaded = await loadSourcingLines(auth.session, id);
  if (!loaded) return notFound("采购 RFQ 不存在或不属于当前租户");
  const { prfq, lines } = loaded;

  const url = new URL(_req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const batchSize = Number(url.searchParams.get("batchSize") ?? 20);

  // 线下供应商报价(已落库)一并进入比价集合
  const offlineLines = await prisma.supplierQuoteLine.findMany({
    where: tenantWhere(auth.session.tenantId, {
      supplierQuote: { procurementRfqId: id },
    }),
    include: { supplierQuote: { select: { supplierId: true, quotedAt: true } } },
  });

  const targets = lines.filter((l) => l.mpn);
  const slice = nextBatchSlice(targets.length, offset, batchSize);
  const batch = slice ? targets.slice(slice.start, slice.end) : [];

  const results = [];
  const degradedAll: { provider: string; kind: string; message: string }[] = [];

  for (const line of batch) {
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

  const processed = slice ? slice.end : targets.length;
  return NextResponse.json({
    procurementRfqId: id,
    mode: prfq.sourcingMode,
    offset,
    batchSize,
    progress: computeProgress(targets.length, processed),
    results,
    degraded: degradedAll,
  });
}
