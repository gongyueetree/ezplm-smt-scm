import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { upsertQuoteLine } from "@/lib/server/repositories/quote";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({ bomVersionId: z.string().min(1) });

/**
 * 从 BOM 版本批量生成报价行(PR7 遗留项)。
 * 只取**已人工确认匹配**的行(BomLineDecision 存在且非 NO_MATCH);
 * 采购成本优先取该 BOM 行**已选定**的供应商报价,取不到则留空由人工填 ——
 * 绝不臆造成本。物料分类一律留 categoryConfirmed=false,仍需逐行人工确认。
 */
export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { versionId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  const lines = await prisma.bOMLine.findMany({
    where: tenantWhere(auth.session.tenantId, { bomVersionId: parsed.data.bomVersionId }),
    orderBy: { lineNo: "asc" },
    include: { decisions: true },
  });
  if (lines.length === 0) return notFound("BOM 版本不存在或没有行");

  const confirmed = lines.filter((l) => l.decisions[0] && l.decisions[0].decision !== "NO_MATCH");
  if (confirmed.length === 0) {
    return NextResponse.json(
      { error: "该 BOM 没有已人工确认的匹配行,请先在匹配确认页逐行确认" },
      { status: 422 },
    );
  }

  // 已选定的供应商报价 → 采购成本
  const selected = await prisma.supplierQuoteLine.findMany({
    where: tenantWhere(auth.session.tenantId, {
      selected: true,
      bomLineId: { in: confirmed.map((l) => l.id) },
    }),
  });
  const costByBomLine = new Map(selected.map((s) => [s.bomLineId ?? "", String(s.unitPrice)]));

  let created = 0;
  let missingCost = 0;
  const frozen: string[] = [];
  for (const [i, l] of confirmed.entries()) {
    const cost = costByBomLine.get(l.id) ?? null;
    if (!cost) missingCost += 1;
    const r = await upsertQuoteLine(auth.session, versionId, {
      lineNo: i + 1,
      category: "MATERIAL",
      qty: String(l.qty),
      purchaseCost: cost,
      quotedMpn: l.mpn,
      quotedMfg: l.manufacturer,
      note: l.description,
    });
    if (r.ok) created += 1;
    else frozen.push(r.message);
  }

  if (created === 0 && frozen.length > 0) {
    return NextResponse.json({ error: frozen[0] }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    created,
    missingCost,
    note:
      missingCost > 0
        ? `${missingCost} 行没有已选定的供应商报价,采购成本留空待人工填写(系统不臆造成本)`
        : undefined,
  });
}
