import ExcelJS from "exceljs";
import { deriveShortageList } from "@/lib/domain/kitting";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { buildKittingReport } from "@/lib/server/repositories/kitting";

export const runtime = "nodejs";

/** Call 料表导出(SPEC §16 批量导出的第一项) */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const versionId = url.searchParams.get("v");
  if (!versionId) return badRequest("缺少 BOM 版本参数 v");
  const boards = Number(url.searchParams.get("boards") ?? 100);
  const scrapRate = url.searchParams.get("scrap") ?? "0";

  const data = await buildKittingReport(auth.session.tenantId, versionId, { boards, scrapRate });
  if (!data) return notFound("BOM 版本不存在或不属于当前租户");

  const shortages = deriveShortageList(data.report);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Call 料表");
  ws.addRow([`${data.version.bom.name} V${data.version.versionNo} · 投产 ${boards} 台 · 损耗率 ${scrapRate}(待甲方确认)`]);
  ws.addRow([
    `齐套率 ${data.report.summary.kitRate === null ? "—" : (data.report.summary.kitRate * 100).toFixed(1) + "%"}`,
    `缺料 ${data.report.summary.shortLines} 行`,
    `数据未知 ${data.report.summary.unknownLines} 行`,
    `预计齐料 ${data.report.summary.readyDate?.slice(0, 10) ?? "未知"}`,
  ]);
  ws.addRow([]);
  ws.addRow(["MPN", "制造商", "位号", "需求", "库存", "在途", "缺口", "建议采购", "最早可用", "状态"]);
  for (const l of shortages) {
    ws.addRow([
      l.mpn ?? "",
      l.manufacturer ?? "",
      l.refDes ?? "",
      l.requiredQty,
      l.stockQty ?? "未知",
      l.inTransitQty ?? "未知",
      l.shortageQty ?? "未知",
      l.suggestedPurchaseQty ?? "",
      l.eta?.slice(0, 10) ?? "",
      l.status === "unknown" ? "数据未知" : "缺料",
    ]);
  }
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.getRow(4).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 16;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="call-list-${versionId.slice(0, 8)}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
