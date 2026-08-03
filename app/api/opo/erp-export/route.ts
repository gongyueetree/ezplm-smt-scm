import { createHash } from "crypto";
import ExcelJS from "exceljs";
import { forbidden, requireSession } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/data-scope";
import { createErpExportJob, loadOpoLines } from "@/lib/server/repositories/opo";

export const runtime = "nodejs";

/**
 * 生成 ERP 可导入的下单/交期模板(SPEC §14:API 不可回写时的替代路径)。
 * 生成即登记 IntegrationJob(幂等键防重复生成)。
 */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可导出 ERP 模板");
  }

  // PR-G:导出同样受数据范围约束 —— 否则供应商可用导出绕过页面过滤
  const scope = await scopeFor(auth.session, "OPO_LINE");
  const lines = await loadOpoLines(auth.session.tenantId, scope);
  const day = new Date().toISOString().slice(0, 10);
  const key = createHash("sha256")
    .update(`erp-export:${auth.session.tenantId}:${day}:${lines.length}`)
    .digest("hex")
    .slice(0, 32);

  await createErpExportJob(auth.session, { day, lineCount: lines.length }, key);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ERP 交期回写模板");
  ws.addRow(["PO 号", "行号", "MPN", "订购量", "未交量", "ERP 承诺交期", "供应商回复 ETA", "回复数量", "回复来源"]);
  for (const l of lines) {
    ws.addRow([
      l.poNo,
      l.lineNo,
      l.mpn ?? "",
      l.qtyOrdered,
      l.qtyOpen,
      l.promiseDate?.slice(0, 10) ?? "",
      l.latestReply?.replyEta?.slice(0, 10) ?? "",
      l.latestReply?.replyQty ?? "",
      l.latestReply?.replySource ?? "",
    ]);
  }
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 18;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="erp-eta-template-${day}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
