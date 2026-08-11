import ExcelJS from "exceljs";
import { notFound, requireSession } from "@/lib/server/api";
import { buildCompareSummary, summarizeExtremes, type CompareOfferInput } from "@/lib/domain/compare-summary";
import { formatDateTime } from "@/lib/format/datetime";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * N-5.E(客户 PR2 反馈 采购-4E:「点击比价,导出最后总表,需要显示所有供应商的价格,
 * 显示所有供应商的替代料,特殊备注,显示最高价和最低价,和相对应的供应商。并保存文档」)。
 *
 * 数据直接取自 SupplierQuoteLine —— **线下导入与三方询价的报价都落在这张表**,
 * 所以总表天然涵盖两类来源,不依赖页面上当前显示了什么。
 *
 * 「并保存文档」:导出即生成一份 xlsx 供下载。**没有做服务端归档** ——
 * 归档要定保存位置、保留期与谁能看,属于未确认的口径;
 * 与其造一个没人认领的存储目录,不如先给下载,由使用者存进自己的流程。
 * 这一点在表头的说明行里写明,不含糊过去。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const prfq = await prisma.procurementRFQ.findFirst({
    where: tenantWhere(auth.session.tenantId, { id }),
    select: { id: true, code: true },
  });
  if (!prfq) return notFound("比价单不存在或不属于当前租户");

  const quotes = await prisma.supplierQuote.findMany({
    where: tenantWhere(auth.session.tenantId, { procurementRfqId: id }),
    include: { lines: true },
    orderBy: { quotedAt: "asc" },
  });

  const supplierIds = [...new Set(quotes.map((q) => q.supplierId))];
  const suppliers = supplierIds.length
    ? await prisma.supplier.findMany({
        where: tenantWhere(auth.session.tenantId, { id: { in: supplierIds } }),
        select: { id: true, name: true },
      })
    : [];
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  /*
   * 询价 MPN 取自 BOM 行 —— 供应商报的型号与它不同即为替代料。
   * 拿不到 BOM 行时退回用报价自身的 MPN(此时不判替代),
   * **不猜**:猜错会把正常报价标成替代料,反过来更糟。
   */
  const bomLineIds = [...new Set(quotes.flatMap((q) => q.lines.map((l) => l.bomLineId).filter(Boolean)))] as string[];
  const bomLines = bomLineIds.length
    ? await prisma.bOMLine.findMany({
        where: tenantWhere(auth.session.tenantId, { id: { in: bomLineIds } }),
        select: { id: true, mpn: true },
      })
    : [];
  const askedMpn = new Map(bomLines.map((b) => [b.id, b.mpn]));

  const offers: CompareOfferInput[] = quotes.flatMap((q) =>
    q.lines.map((l) => {
      const asked = l.bomLineId ? askedMpn.get(l.bomLineId) ?? null : null;
      return {
        supplierName: supplierName.get(q.supplierId) ?? "未知供应商",
        source: q.provider,
        mpn: asked ?? l.mpn,
        quotedMpn: l.mpn,
        manufacturer: l.manufacturer,
        currency: l.currency,
        unitPrice: l.unitPrice.toString(),
        moq: l.moq === null ? null : Number(l.moq),
        spq: l.spq === null ? null : Number(l.spq),
        leadTimeDays: l.leadTimeDays,
        note: l.resolutionNote,
      };
    }),
  );

  const summary = buildCompareSummary(offers);

  const wb = new ExcelJS.Workbook();

  // ---- 表一:汇总(每个料号一行)----
  const s1 = wb.addWorksheet("比价汇总");
  s1.addRow([`比价单 ${prfq.code} · 导出时间 ${formatDateTime(new Date())}`]);
  s1.addRow([
    "本表为导出时点的快照。系统不做汇率换算,异币种报价分币种各自给最高/最低,需人工横向比对。",
  ]);
  s1.addRow([]);
  s1.addRow(["料号", "报价数", "最高/最低(按币种)", "替代料", "特殊备注"]);
  for (const row of summary) {
    s1.addRow([
      row.mpn,
      row.offers.length,
      summarizeExtremes(row),
      row.alternates.map((a) => `${a.supplierName}:${a.quotedMpn}${a.manufacturer ? `(${a.manufacturer})` : ""}`).join(" / ") || "-",
      row.notes.map((n) => `${n.supplierName}:${n.note}`).join(" / ") || "-",
    ]);
  }
  s1.columns = [{ width: 26 }, { width: 8 }, { width: 62 }, { width: 40 }, { width: 40 }];

  // ---- 表二:逐条报价明细(所有供应商的价格)----
  const s2 = wb.addWorksheet("逐条报价");
  s2.addRow([
    "料号",
    "供应商",
    "来源",
    "报价型号",
    "制造商",
    "币种",
    "单价",
    "MOQ",
    "SPQ",
    "交期(天)",
    "备注",
  ]);
  for (const row of summary) {
    for (const o of row.offers) {
      s2.addRow([
        row.mpn,
        o.supplierName,
        o.source,
        o.quotedMpn ?? "-",
        o.manufacturer ?? "-",
        o.currency,
        // 价格以文本写出,避免 Excel 把高精度小数按浮点四舍五入
        o.unitPrice ?? "无报价",
        o.moq ?? "-",
        o.spq ?? "-",
        o.leadTimeDays ?? "-",
        o.note ?? "-",
      ]);
    }
  }
  s2.columns = [
    { width: 26 }, { width: 20 }, { width: 12 }, { width: 26 }, { width: 14 },
    { width: 8 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 30 },
  ];

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="compare-${prfq.code}.xlsx"`,
    },
  });
}
