import { NextResponse } from "next/server";
import {
  detectSupplierQuoteMapping,
  isSupplierQuoteMappingUsable,
  missingSupplierQuoteFields,
  SUPPLIER_QUOTE_FIELD_LABELS,
  toSupplierQuoteLines,
} from "@/lib/domain/supplier-quote-parse";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { extractRows } from "@/lib/server/file-parse";
import { importOfflineQuote } from "@/lib/server/repositories/procurement";
import { getStorageProvider } from "@/lib/server/storage";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * 导入线下供应商报价 Excel(SPEC §11 + Backlog B5)。
 * 列映射走 supplier-quote-parse:MPN / 单价 / 币种 / MOQ / SPQ / Lead Time 全部识别 ——
 * 这些是比价排名与异常判定的输入,缺了会让"最低价"虚假占优、超交期不被标异常。
 * 原始文件归档;落库当刻固化原始异常集合(wasFlagged)。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可导入供应商报价");
  }
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("需要 multipart/form-data");
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("未选择文件");
  if (file.size > MAX_BYTES) return badRequest("文件超过 20MB 上限");

  const supplierId = String(form.get("supplierId") ?? "").trim();
  if (!supplierId) return badRequest("必须指定供应商");
  const currency = String(form.get("currency") ?? "CNY").trim().toUpperCase();

  const thresholds = {
    currency,
    maxUnitPrice: (form.get("maxUnitPrice") as string) || null,
    maxLeadTimeDays: form.get("maxLeadTimeDays") ? Number(form.get("maxLeadTimeDays")) : null,
  };

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await getStorageProvider().put(file.name, buffer, {
    contentType: file.type || "application/octet-stream",
    prefix: `supplier-quotes/${auth.session.tenantId}`,
  });

  const extracted = await extractRows(file.name, buffer, file.type);
  if (extracted.requiresManualTranscription || extracted.rows.length === 0) {
    return NextResponse.json(
      {
        error: extracted.note ?? "未能从文件中解析出表格内容",
        fileKey: stored.key,
        requiresManualTranscription: extracted.requiresManualTranscription,
      },
      { status: 422 },
    );
  }

  const mapping = detectSupplierQuoteMapping(extracted.rows);
  if (!isSupplierQuoteMappingUsable(mapping)) {
    return NextResponse.json(
      {
        error: `未能识别必需列:${missingSupplierQuoteFields(mapping)
          .map((f) => SUPPLIER_QUOTE_FIELD_LABELS[f])
          .join("、")}`,
        missingFields: missingSupplierQuoteFields(mapping),
        preview: extracted.rows.slice(0, 5),
        fileKey: stored.key,
      },
      { status: 422 },
    );
  }

  const { lines, skipped } = toSupplierQuoteLines(extracted.rows, mapping, {
    fallbackCurrency: currency,
  });
  if (lines.length === 0) {
    return NextResponse.json(
      { error: "文件中没有可导入的报价行", skipped, fileKey: stored.key },
      { status: 422 },
    );
  }

  const quote = await importOfflineQuote(auth.session, {
    procurementRfqId: id,
    supplierId,
    currency,
    sourceFileKey: stored.key,
    quotedAt: new Date(),
    lines: lines.map((l) => ({
      mpn: l.mpn,
      manufacturer: l.manufacturer,
      unitPrice: l.unitPrice,
      currency: l.currency,
      moq: l.moq,
      spq: l.spq,
      leadTimeDays: l.leadTimeDays,
    })),
    thresholds,
  });
  if (!quote) return notFound("采购 RFQ 不存在或不属于当前租户");

  return NextResponse.json(
    {
      quote,
      importedLines: lines.length,
      // 被跳过的行如实返回,不静默丢弃
      skipped,
      mapping: {
        headerRowIndex: mapping.headerRowIndex,
        fields: Object.fromEntries(
          Object.entries(mapping.fields).map(([f, col]) => [
            SUPPLIER_QUOTE_FIELD_LABELS[f as keyof typeof SUPPLIER_QUOTE_FIELD_LABELS],
            (col as number) + 1,
          ]),
        ),
      },
    },
    { status: 201 },
  );
}
