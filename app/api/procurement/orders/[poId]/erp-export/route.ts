import { createHash } from "crypto";
import ExcelJS from "exceljs";
import { forbidden, notFound, requireSession } from "@/lib/server/api";
import { PO_STATUS_LABELS } from "@/lib/domain/po-status";
import { SOURCING_MODE_LABELS } from "@/lib/domain/po-scheduling";
import { createErpExportJob } from "@/lib/server/repositories/opo";
import {
  getPurchaseOrder,
  markErpExported,
} from "@/lib/server/repositories/purchase-order";

export const runtime = "nodejs";

/**
 * 生成 ERP 可导入的**批量下单模板**
 * (客户 docx:「根据上传的 excel 表直接在 ERP 批量下单?这是我们必要需要实现的功能」)。
 *
 * 边界必须说清楚:本系统**不直接在 ERP 下单** —— 产出模板 + 登记 IntegrationJob,
 * 由人工/RPA 导入 ERP。导出成功只代表"模板已生成",不代表 ERP 已接单。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ poId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可导出 ERP 下单模板");
  }

  const { poId } = await params;
  const po = await getPurchaseOrder(auth.session, poId);
  if (!po) return notFound();
  if (po.status !== "APPROVED" && po.status !== "EXPORTED") {
    return new Response(
      JSON.stringify({ error: `订单处于「${PO_STATUS_LABELS[po.status]}」,未审批不得导出下单模板` }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
  }

  // 幂等键含单号与行数:同一单据重复导出不会重复登记集成作业
  const key = createHash("sha256")
    .update(`po-erp-order:${auth.session.tenantId}:${po.poNo}:${po.lines.length}`)
    .digest("hex")
    .slice(0, 32);
  const { job } = await createErpExportJob(
    auth.session,
    { kind: "PO_ORDER", poNo: po.poNo, lineCount: po.lines.length },
    key,
  );
  await markErpExported(auth.session, poId, job.id);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ERP 批量下单模板");
  ws.addRow([
    "PO 号",
    "行号",
    "MPN",
    "制造商",
    "数量",
    "单价",
    "币种",
    "MOQ",
    "SPQ",
    "交期(天)",
    "需求日期",
    "建议下单日",
    "下单模式",
  ]);
  for (const l of po.lines) {
    ws.addRow([
      po.poNo,
      l.lineNo,
      l.mpn ?? "",
      l.manufacturer ?? "",
      l.qty,
      l.unitPrice ?? "",
      l.currency,
      l.moq ?? "",
      l.spq ?? "",
      l.leadTimeDays ?? "",
      l.requestDate?.slice(0, 10) ?? "",
      l.orderByDate?.slice(0, 10) ?? "",
      SOURCING_MODE_LABELS[l.sourcingMode],
    ]);
  }
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 16;
  });
  // 模板里也写明边界,避免落到别人手上被当成"已下单"凭据
  ws.addRow([]);
  ws.addRow(["说明:本表由 ezPLM SMT 生成,仅供 ERP 导入使用;生成不代表 ERP 已接单。"]);

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="erp-po-${po.poNo}.xlsx"`,
    },
  });
}
