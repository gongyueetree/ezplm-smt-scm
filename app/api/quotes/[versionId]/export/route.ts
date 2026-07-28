import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { CATEGORY_LABELS, type QuoteCostCategoryValue } from "@/lib/domain/quote-calc";
import { requireSession } from "@/lib/server/api";
import { getExportSnapshot } from "@/lib/server/repositories/quote";

export const runtime = "nodejs";

/**
 * 正式 XLSX 导出(SPEC §12:审批与正式导出必须使用快照)。
 * 数据**完全取自快照**,不读当前行、不重算 —— 快照缺失即拒绝导出。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { versionId } = await params;

  const source = await getExportSnapshot(auth.session, versionId);
  if (!source.ok) {
    return NextResponse.json({ error: source.message }, { status: 422 });
  }
  const snap = source.snapshot;

  const wb = new ExcelJS.Workbook();
  wb.creator = "ezPLM AI 供应链协同";
  const ws = wb.addWorksheet("报价单");

  ws.addRow([`报价单 ${snap.quoteCode} · Revision ${snap.revision}`]);
  ws.addRow([
    `数据来源:${source.kind === "approved" ? "审批快照" : "提交快照"}`,
    `冻结时间:${snap.frozenAt}`,
    `币种:${snap.summary.currency}`,
  ]);
  ws.addRow([]);

  ws.addRow(["行号", "成本分类", "数量", "采购成本", "Markup", "最终单价", "客户单价", "小计", "PPV"]);
  for (const l of snap.summary.lines) {
    ws.addRow([
      l.lineNo,
      CATEGORY_LABELS[l.category] ?? l.category,
      l.qty,
      l.purchaseCost,
      l.markupPct ?? "-",
      l.finalUnitPrice,
      l.effectiveUnitPrice,
      l.extended,
      l.ppv ?? "-",
    ]);
  }

  ws.addRow([]);
  ws.addRow(["分类汇总"]);
  for (const [cat, amount] of Object.entries(snap.summary.byCategory)) {
    ws.addRow([CATEGORY_LABELS[cat as QuoteCostCategoryValue] ?? cat, amount]);
  }
  ws.addRow(["小计(不含管理费)", snap.summary.subtotalBeforeOverhead]);
  ws.addRow(["管理费", snap.summary.overhead]);
  ws.addRow(["总价", snap.summary.grandTotal]);
  ws.addRow(["PPV 合计", snap.summary.ppvTotal]);

  ws.getRow(1).font = { bold: true, size: 14 };
  ws.getRow(4).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 16;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${snap.quoteCode}-R${snap.revision}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
