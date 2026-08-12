import ExcelJS from "exceljs";
import { badRequest, requireSession } from "@/lib/server/api";
import { type ImportReconciliation } from "@/lib/domain/bom-parse";
import { formatDateTime } from "@/lib/format/datetime";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const MAX_BOMS = 50;
const MAX_LINES_PER_BOM = 5000;

/**
 * E4:**预 BOM 批量导出**(客户 Q9)。
 *
 * 客户点名要保留的东西:客户原始 PN / 描述 / MFG / MPN / Qty,
 * 外加**导入状态与未解决行数** —— 后者是这次导出真正的价值:
 * 拿到文件的人要能一眼看出"这份 BOM 还有 8 行没人认领",
 * 而不是以为导出的就是干净数据。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return badRequest("未选择要导出的 BOM(ids 参数为空)");
  if (ids.length > MAX_BOMS) return badRequest(`一次最多导出 ${MAX_BOMS} 份 BOM`);

  const boms = await prisma.bOM.findMany({
    where: tenantWhere(auth.session.tenantId, { id: { in: ids } }),
    include: {
      versions: { orderBy: { versionNo: "desc" }, take: 1, select: { id: true, versionNo: true } },
    },
  });
  if (boms.length === 0) return badRequest("选中的 BOM 都不存在或不属于当前租户");

  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet("导出说明");
  summary.addRow(["导出时间", formatDateTime(new Date())]);
  summary.addRow(["份数", boms.length]);
  summary.addRow([]);
  summary.addRow(["BOM", "用途", "版本", "行数", "原始行数", "待人工判断", "导入状态"]);
  summary.columns = [{ width: 30 }, { width: 18 }, { width: 8 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 34 }];

  const lines = wb.addWorksheet("BOM 明细");
  lines.addRow([
    "BOM", "用途", "版本", "行号", "位号", "数量",
    "客户料号", "制造商", "MPN", "描述", "封装", "内部料号", "内部料号来源",
  ]);
  lines.columns = [
    { width: 26 }, { width: 16 }, { width: 8 }, { width: 8 }, { width: 18 }, { width: 8 },
    { width: 18 }, { width: 16 }, { width: 24 }, { width: 30 }, { width: 14 }, { width: 18 }, { width: 18 },
  ];

  for (const bom of boms) {
    const v = bom.versions[0];
    const job = await prisma.bOMImportJob.findFirst({
      where: tenantWhere(auth.session.tenantId, { bomId: bom.id }),
      orderBy: { createdAt: "desc" },
      select: { status: true, reconciliation: true },
    });
    const recon = job?.reconciliation as unknown as ImportReconciliation | null;

    const rows = v
      ? await prisma.bOMLine.findMany({
          where: tenantWhere(auth.session.tenantId, { bomVersionId: v.id }),
          orderBy: { lineNo: "asc" },
          take: MAX_LINES_PER_BOM + 1,
        })
      : [];
    const truncated = rows.length > MAX_LINES_PER_BOM;

    summary.addRow([
      bom.name,
      bom.purpose === "PRODUCTION" ? "正式 BOM" : "预 BOM",
      v ? `V${v.versionNo}` : "无版本",
      Math.min(rows.length, MAX_LINES_PER_BOM),
      recon?.totalRows ?? "未记录",
      // 「未解决行数」= 导入时没能判定是不是物料行的那些
      recon?.needsReview ?? "未记录",
      recon === null
        ? `${job?.status ?? "无导入记录"} · 该次导入早于行去向功能,无逐行记录`
        : recon.balanced
          ? `${job?.status ?? "-"} · 行去向已对平`
          : `${job?.status ?? "-"} · **行去向对不上账,请勿直接使用**`,
    ]);

    for (const l of rows.slice(0, MAX_LINES_PER_BOM)) {
      lines.addRow([
        bom.name,
        bom.purpose === "PRODUCTION" ? "正式 BOM" : "预 BOM",
        v ? `V${v.versionNo}` : "",
        l.lineNo,
        l.refDes ?? "",
        l.qty === null ? "" : String(l.qty),
        l.customerPn ?? "",
        l.manufacturer ?? "",
        l.mpn ?? "",
        l.description ?? "",
        l.footprint ?? "",
        l.internalPn ?? "",
        l.internalPnSource ?? "",
      ]);
    }
    if (truncated) {
      lines.addRow([bom.name, "", "", "", `⚠ 该 BOM 行数超过 ${MAX_LINES_PER_BOM},本文件只含前 ${MAX_LINES_PER_BOM} 行`]);
    }
  }

  summary.addRow([]);
  summary.addRow([
    "说明",
    "「待人工判断」是导入时没能判定是不是物料行的行数。不为 0 表示这份 BOM 还有内容没人认领 —— 导出的不等于干净数据。",
  ]);

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pre-boms-${boms.length}.xlsx"`,
    },
  });
}
