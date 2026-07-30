/**
 * 由 BOM 版本批量生成报价行。
 *
 * 从路由里抽出来共用:既有的 `POST /api/quotes/[versionId]/from-bom`(报价页发起)
 * 与新增的 `POST /api/bom/version/[versionId]/to-quote`(BOM 页一键转化)
 * 必须走**同一份逻辑** —— 两个入口各写一遍,规则迟早会分叉。
 *
 * 纪律(逐条保持不变):
 * - 只取**已人工确认**的匹配行(有 BomLineDecision 且非 NO_MATCH);
 * - 采购成本只取该行**已选定**的供应商报价,取不到就留空 —— **绝不臆造成本**;
 * - 物料分类一律留 categoryConfirmed=false,仍需逐行人工确认。
 */
import { prisma } from "@/lib/server/db";
import { upsertQuoteLine } from "@/lib/server/repositories/quote";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantWhere } from "@/lib/server/tenant-scope";

export type GenerateResult =
  | { ok: true; count: number; missingCost: number; note?: string }
  | { ok: false; reason: string };

export async function generateQuoteLinesFromBom(
  session: SessionRef,
  quoteVersionId: string,
  bomVersionId: string,
): Promise<GenerateResult> {
  const lines = await prisma.bOMLine.findMany({
    where: tenantWhere(session.tenantId, { bomVersionId }),
    orderBy: { lineNo: "asc" },
    include: { decisions: true },
  });
  if (lines.length === 0) return { ok: false, reason: "BOM 版本不存在或没有行" };

  const confirmed = lines.filter((l) => l.decisions[0] && l.decisions[0].decision !== "NO_MATCH");
  if (confirmed.length === 0) {
    return {
      ok: false,
      reason: "该 BOM 没有已人工确认的匹配行,请先在匹配确认页逐行确认",
    };
  }

  const selected = await prisma.supplierQuoteLine.findMany({
    where: tenantWhere(session.tenantId, {
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
    const r = await upsertQuoteLine(session, quoteVersionId, {
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

  if (created === 0 && frozen.length > 0) return { ok: false, reason: frozen[0] };

  return {
    ok: true,
    count: created,
    missingCost,
    note:
      missingCost > 0
        ? `${missingCost} 行没有已选定的供应商报价,采购成本留空待人工填写(系统不臆造成本)`
        : undefined,
  };
}
