/**
 * R4-7(§41/§42/§43):RFQ × Supplier 行清单 + 线下 Excel 闭环 + 报价审批。
 *
 * - 每个供应商不同 line list(选择表,不是第二套 RFQ);
 * - 线下 Excel 回传与在线链接落**同一** canonical SupplierOffer+PriceBreak[];
 * - Quoted Manufacturer 走同一 ManufacturerResolver(§43),冲突标
 *   SUPPLIER_QUOTE_MANUFACTURER_CONFLICT,不 silent replace;
 * - 审批(§37):RECEIVED→REVIEWED/APPROVED/REJECTED/EXPIRED,人工;审计全程。
 */
import ExcelJS from "exceljs";
import { manufacturerMatches } from "@/lib/providers/common/mpn";
import {
  buildRfqExportRows,
  parseQuoteRows,
  type ParsedQuoteGroup,
  type QuoteUploadIssue,
} from "@/lib/domain/rfq-excel";
import { resolveManufacturer } from "@/lib/integration/erp/normalization/manufacturer-resolver";
import { loadResolverContext } from "@/lib/server/repositories/manufacturer-review";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export interface SupplierLineInput {
  partId?: string | null;
  internalPn?: string | null;
  mpn?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  requestedQty: string;
}

/** 覆盖式设置某供应商的行清单(§41:不同供应商不同清单;同行可发多家) */
export async function setSupplierLines(
  session: SessionRef,
  prfqId: string,
  supplierId: string,
  lines: SupplierLineInput[],
): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
  const [prfq, supplier] = await Promise.all([
    prisma.procurementRFQ.findFirst({ where: tenantWhere(session.tenantId, { id: prfqId }) }),
    prisma.supplier.findFirst({ where: tenantWhere(session.tenantId, { id: supplierId }) }),
  ]);
  if (!prfq) return { ok: false, reason: "询价单不存在或不属于当前租户" };
  if (!supplier) return { ok: false, reason: "供应商不存在或不属于当前租户" };
  if (lines.length === 0) return { ok: false, reason: "行清单为空" };
  await prisma.$transaction(async (tx) => {
    await tx.procurementRfqSupplierLine.deleteMany({
      where: tenantWhere(session.tenantId, { procurementRfqId: prfqId, supplierId }),
    });
    for (const l of lines) {
      await tx.procurementRfqSupplierLine.create({
        data: tenantData(session.tenantId, {
          procurementRfqId: prfqId,
          supplierId,
          partId: l.partId ?? null,
          internalPn: l.internalPn ?? null,
          mpn: l.mpn ?? null,
          manufacturer: l.manufacturer ?? null,
          description: l.description ?? null,
          requestedQty: l.requestedQty,
          createdById: session.userId,
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "RFQ_SUPPLIER_LINES_SET",
      entityType: "ProcurementRFQ",
      entityId: prfqId,
      after: { supplierId, lines: lines.length },
    });
  });
  return { ok: true, count: lines.length };
}

export async function listSupplierLines(session: SessionRef, prfqId: string) {
  return prisma.procurementRfqSupplierLine.findMany({
    where: tenantWhere(session.tenantId, { procurementRfqId: prfqId }),
    orderBy: [{ supplierId: "asc" }, { createdAt: "asc" }],
  });
}

/** §42:导出某供应商的 RFQ Excel(只含该供应商的行) */
export async function buildSupplierRfqExcel(
  session: SessionRef,
  prfqId: string,
  supplierId: string,
): Promise<{ ok: true; buf: Buffer; fileName: string } | { ok: false; reason: string }> {
  const [prfq, supplier, lines] = await Promise.all([
    prisma.procurementRFQ.findFirst({ where: tenantWhere(session.tenantId, { id: prfqId }) }),
    prisma.supplier.findFirst({ where: tenantWhere(session.tenantId, { id: supplierId }) }),
    prisma.procurementRfqSupplierLine.findMany({
      where: tenantWhere(session.tenantId, { procurementRfqId: prfqId, supplierId }),
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!prfq || !supplier) return { ok: false, reason: "询价单或供应商不存在" };
  if (lines.length === 0) return { ok: false, reason: "该供应商还没有行清单(先设置 supplier lines)" };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RFQ");
  for (const row of buildRfqExportRows(
    lines.map((l) => ({
      rfqNo: prfq.code,
      supplierName: supplier.name,
      internalPn: l.internalPn,
      mpn: l.mpn,
      manufacturer: l.manufacturer,
      description: l.description,
      requestedQty: l.requestedQty.toString(),
    })),
  )) {
    ws.addRow(row);
  }
  return {
    ok: true,
    buf: Buffer.from(await wb.xlsx.writeBuffer()),
    fileName: `RFQ-${prfq.code}-${supplier.code}.xlsx`,
  };
}

export interface QuoteUploadPreview {
  groups: (ParsedQuoteGroup & {
    manufacturerResolution: string;
    canonicalManufacturerName: string | null;
    flags: string[];
  })[];
  issues: QuoteUploadIssue[];
  skippedRows: number;
  admissible: boolean;
}

/** §42/§43:解析回传 Excel + Quoted Manufacturer 走同一 Resolver,冲突打标 */
export async function previewQuoteUpload(
  session: SessionRef,
  prfqId: string,
  supplierId: string,
  fileBuf: Buffer,
): Promise<QuoteUploadPreview> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileBuf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { groups: [], issues: [{ row: 0, message: "空工作簿" }], skippedRows: 0, admissible: false };
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => headers.push(String(cell.value ?? "").trim()));
  const rows: { rowNo: number; cells: Record<string, string> }[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const cells: Record<string, string> = {};
    headers.forEach((h, i) => {
      cells[h] = String(row.getCell(i + 1).value ?? "").trim();
    });
    rows.push({ rowNo: n, cells });
  });
  const { groups, issues, skippedRows } = parseQuoteRows(rows);

  const ctx = await loadResolverContext(session.tenantId);
  const enriched = groups.map((g) => {
    const res = resolveManufacturer(
      { rawManufacturer: g.quotedManufacturer, mpn: g.quotedMpn, materialKind: "ELECTRONIC_COMPONENT" },
      ctx,
    );
    const flags: string[] = [];
    if (res.resolution === "MANUFACTURER_CONFLICT") flags.push("SUPPLIER_QUOTE_MANUFACTURER_CONFLICT");
    // 换型报价:quotedMpn ≠ 询价 MPN 时提示(不是错误,人工留意)
    if (g.requestedMpn && g.quotedMpn.toUpperCase() !== g.requestedMpn.toUpperCase()) {
      flags.push("QUOTED_DIFFERENT_MPN");
    }
    if (
      g.quotedManufacturer &&
      res.canonicalManufacturerName &&
      !manufacturerMatches(res.canonicalManufacturerName, g.quotedManufacturer) &&
      res.resolution !== "MANUFACTURER_CONFLICT"
    ) {
      flags.push("MANUFACTURER_NORMALIZED");
    }
    return {
      ...g,
      manufacturerResolution: res.resolution,
      canonicalManufacturerName: res.canonicalManufacturerName,
      flags,
    };
  });

  void prfqId;
  void supplierId;
  return { groups: enriched, issues, skippedRows, admissible: issues.length === 0 && enriched.length > 0 };
}

/** 落库:每组一条 SupplierOffer(status=RECEIVED)+ 全部 PriceBreak(绝不只留最低价) */
export async function commitQuoteUpload(
  session: SessionRef,
  prfqId: string,
  supplierId: string,
  preview: QuoteUploadPreview,
): Promise<{ ok: true; offers: number; breaks: number } | { ok: false; reason: string }> {
  if (!preview.admissible) {
    return { ok: false, reason: `存在 ${preview.issues.length} 个行级问题或零有效组 —— 修正后重传` };
  }
  const supplier = await prisma.supplier.findFirst({
    where: tenantWhere(session.tenantId, { id: supplierId }),
  });
  if (!supplier) return { ok: false, reason: "供应商不存在" };
  let offers = 0;
  let breaks = 0;
  await prisma.$transaction(async (tx) => {
    for (const g of preview.groups) {
      const offer = await tx.supplierOffer.create({
        data: tenantData(session.tenantId, {
          provider: "OFFLINE" as never,
          supplierId,
          mpn: g.quotedMpn,
          manufacturer: g.canonicalManufacturerName ?? g.quotedManufacturer,
          currency: g.currency,
          moq: g.moq,
          spq: g.spq,
          leadTimeDays: g.leadTimeDays,
          validUntil: g.validUntil ? new Date(g.validUntil) : null,
          supplierNote: [g.remark, ...g.flags].filter(Boolean).join(" | ") || null,
          procurementRfqId: prfqId,
          status: "RECEIVED" as never,
          sourceUpdatedAt: new Date(),
        }),
      });
      offers++;
      for (const b of g.breaks) {
        await tx.priceBreak.create({
          data: tenantData(session.tenantId, {
            supplierOfferId: offer.id,
            minQty: b.minQty,
            unitPrice: b.unitPrice,
          }),
        });
        breaks++;
      }
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "SUPPLIER_QUOTE_EXCEL_IMPORT",
      entityType: "ProcurementRFQ",
      entityId: prfqId,
      after: { supplierId, offers, breaks, skippedRows: preview.skippedRows },
    });
  });
  return { ok: true, offers, breaks };
}

/** §37:报价审批(采购/管理层;人工) */
export async function reviewSupplierOffer(
  session: SessionRef,
  offerId: string,
  status: "REVIEWED" | "APPROVED" | "REJECTED" | "EXPIRED",
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const offer = await prisma.supplierOffer.findFirst({
    where: tenantWhere(session.tenantId, { id: offerId }),
  });
  if (!offer) return { ok: false, reason: "报价不存在或不属于当前租户" };
  await prisma.$transaction(async (tx) => {
    await tx.supplierOffer.update({
      where: { id: offer.id },
      data: { status, reviewedById: session.userId, reviewedAt: new Date() },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "SUPPLIER_OFFER_REVIEW",
      entityType: "SupplierOffer",
      entityId: offer.id,
      before: { status: offer.status },
      after: { status },
    });
  });
  return { ok: true };
}
