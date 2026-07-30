import ExcelJS from "exceljs";
import { notFound, requireSession } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * 标准模板 BOM 一键导出(客户 xlsx:「标准模板BOM一键导出」→「非标BOM格式一键转换…无导出button」)。
 *
 * 列顺序即本系统的标准模板;数量为 0 的行导出为 DNP 标注而不是静默丢弃 ——
 * DNP 是有效信息,丢了下游会当成漏料。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { versionId } = await params;

  const version = await prisma.bOMVersion.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: versionId }),
    include: { bom: { select: { name: true } }, lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!version) return notFound();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("标准 BOM");
  ws.addRow(["行号", "位号", "数量", "MPN", "制造商", "客户料号", "描述", "封装", "备注"]);
  for (const l of version.lines) {
    const qty = Number(l.qty);
    ws.addRow([
      l.lineNo,
      l.refDes ?? "",
      qty,
      l.mpn ?? "",
      l.manufacturer ?? "",
      l.customerPn ?? "",
      l.description ?? "",
      l.footprint ?? l.packageCode ?? "",
      qty === 0 ? "DNP(不贴装)" : "",
    ]);
  }
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 18;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const name = `${version.bom.name}-V${version.versionNo}`.replace(/[^\w.-]+/g, "_");
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="bom-${name}.xlsx"`,
    },
  });
}
