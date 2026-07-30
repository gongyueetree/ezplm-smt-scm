import ExcelJS from "exceljs";
import { requireSession } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/** 导出同步记录(客户:「无完整同步操作日志,无法导出同步记录」) */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);

  const where: Record<string, unknown> = {};
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (type) where.type = type;
  if (status) where.status = status;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const jobs = await prisma.integrationJob.findMany({
    where: tenantWhere(auth.session.tenantId, where),
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ERP 同步日志");
  ws.addRow(["时间", "类型", "状态", "重试次数", "幂等键", "载荷", "错误"]);
  for (const j of jobs) {
    ws.addRow([
      j.createdAt.toISOString().slice(0, 19).replace("T", " "),
      j.type,
      j.status,
      j.attempts,
      j.idempotencyKey ?? "",
      JSON.stringify(j.payload),
      j.lastError ?? "",
    ]);
  }
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 20;
  });
  ws.addRow([]);
  ws.addRow(["说明:本系统不直连 ERP 写入;「已生成」不代表 ERP 已接收,实际入账以 ERP 侧为准。"]);

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="erp-sync-log.xlsx"`,
    },
  });
}
