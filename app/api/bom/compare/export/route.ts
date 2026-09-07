import { notFound, requireSession } from "@/lib/server/api";
import { buildCompareExportRows } from "@/lib/domain/bom-compare";
import { compareBomVersions } from "@/lib/domain/bom-compare";
import type { ParsedBomLine } from "@/lib/domain/bom-parse";
import { toCsv } from "@/lib/domain/csv";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

async function loadLines(tenantId: string, versionId: string): Promise<ParsedBomLine[] | null> {
  const version = await prisma.bOMVersion.findFirst({
    where: tenantWhere(tenantId, { id: versionId }),
    select: { id: true },
  });
  if (!version) return null;
  const rows = await prisma.bOMLine.findMany({
    where: tenantWhere(tenantId, { bomVersionId: versionId }),
    orderBy: { lineNo: "asc" },
  });
  return rows.map((l) => ({
    sourceRow: l.lineNo,
    lineNo: l.lineNo,
    refDes: l.refDes,
    qty: Number(l.qty),
    mpn: l.mpn,
    manufacturer: l.manufacturer,
    customerPn: l.customerPn,
    internalPn: null,
    description: l.description,
    footprint: l.footprint,
    issues: [],
  }));
}

/**
 * F7:版本差异导出(CSV)。
 * 与对比页共用 `compareBomVersions` —— **没有第二套 diff**(单测锁定)。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  const [before, after] = await Promise.all([
    loadLines(auth.session.tenantId, from),
    loadLines(auth.session.tenantId, to),
  ]);
  if (!before || !after) return notFound("版本不存在或不属于当前租户");

  const { entries, summary } = compareBomVersions(before, after);
  const rows = buildCompareExportRows(entries);

  const csv = toCsv(
    ["变更类型", "对比键", "位号", "变更前 MPN", "变更后 MPN", "变更前用量", "变更后用量", "变更说明"],
    rows.map((r) => [r.typeLabel, r.key, r.refDes, r.beforeMpn, r.afterMpn, r.beforeQty, r.afterQty, r.changes]),
  );
  // 汇总行放文件头注释,导出与页面口径一致
  const header = `# BOM 版本差异导出;新增 ${summary.added} · 删除 ${summary.removed} · 数量变更 ${summary.qtyChanged} · 料号变更 ${summary.partChanged} · 未变化 ${summary.unchanged}\n`;

  return new Response("﻿" + header + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bom-diff-${from.slice(0, 8)}-${to.slice(0, 8)}.csv"`,
    },
  });
}
