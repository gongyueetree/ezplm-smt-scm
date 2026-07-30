import ExcelJS from "exceljs";
import { requireSession } from "@/lib/server/api";
import {
  DEFAULT_SCRAP_COLUMNS,
  renderScrapRow,
  summarizeScrap,
  type ScrapRow,
  type ScrapTemplateColumn,
} from "@/lib/domain/scrap-report";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/** 依据客户模板导出损耗(客户 xlsx 要求);无模板时用默认列 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);

  const where: Record<string, unknown> = {};
  if (url.searchParams.get("period")) where.period = url.searchParams.get("period");
  if (url.searchParams.get("customerId")) where.customerId = url.searchParams.get("customerId");
  if (url.searchParams.get("mpn")) where.mpn = { contains: url.searchParams.get("mpn"), mode: "insensitive" };

  const [records, template] = await Promise.all([
    prisma.scrapRecord.findMany({
      where: tenantWhere(auth.session.tenantId, where),
      orderBy: { createdAt: "desc" },
      take: 10000,
    }),
    url.searchParams.get("templateId")
      ? prisma.scrapExportTemplate.findFirst({
          where: tenantWhere(auth.session.tenantId, { id: url.searchParams.get("templateId")! }),
        })
      : Promise.resolve(null),
  ]);

  const columns: ScrapTemplateColumn[] =
    template && Array.isArray(template.columns)
      ? (template.columns as unknown as ScrapTemplateColumn[])
      : DEFAULT_SCRAP_COLUMNS;

  const rows: ScrapRow[] = records.map((r) => ({
    period: r.period,
    customerId: r.customerId,
    workOrder: r.workOrder,
    mpn: r.mpn,
    issuedQty: r.issuedQty.toString(),
    scrapQty: r.scrapQty.toString(),
    reason: r.reason,
  }));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(template?.name ?? "损耗明细");
  ws.addRow(columns.map((c) => c.header));
  for (const r of rows) ws.addRow(renderScrapRow(r, columns));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 16;
  });

  const s = summarizeScrap(rows);
  ws.addRow([]);
  ws.addRow(["合计发料", s.totalIssued, "合计报废", s.totalScrap]);
  ws.addRow([
    "整体损耗率",
    s.overallRate === null ? "不可算(合计发料为 0)" : `${(Number(s.overallRate) * 100).toFixed(2)}%`,
  ]);
  if (s.zeroIssuedWithScrap > 0) {
    ws.addRow([`注意:有 ${s.zeroIssuedWithScrap} 行发料为 0 却有报废,其损耗率不可算,已单列`]);
  }
  ws.addRow(["数据来源:人工导入(本系统无工单投料数据,真实投料/报废以 MES/ERP 为准)"]);

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="scrap-report.xlsx"`,
    },
  });
}
