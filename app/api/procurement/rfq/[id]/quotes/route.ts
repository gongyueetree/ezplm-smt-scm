import { NextResponse } from "next/server";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { extractRows } from "@/lib/server/file-parse";
import { detectColumnMapping, isMappingUsable, missingRequiredFields, toStandardLines } from "@/lib/domain/bom-parse";
import { importOfflineQuote } from "@/lib/server/repositories/procurement";
import { getStorageProvider } from "@/lib/server/storage";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * 导入线下供应商报价 Excel(SPEC §11)。
 * 复用 BOM 的列映射能力;价格列取「单价」同义词。
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

  const mapping = detectColumnMapping(extracted.rows);
  if (!isMappingUsable(mapping)) {
    return NextResponse.json(
      { error: "未能识别必需列(至少需要 MPN 与数量/单价)", missingFields: missingRequiredFields(mapping), preview: extracted.rows.slice(0, 5) },
      { status: 422 },
    );
  }

  // 单价列:供应商报价表的「数量」列位常放单价,这里以显式的价格同义词为准
  const priceCol = extracted.rows[mapping.headerRowIndex].findIndex((h) =>
    /单价|价格|price|unitprice/i.test(String(h ?? "").replace(/\s/g, "")),
  );
  if (priceCol < 0) {
    return NextResponse.json({ error: "未找到单价列(需包含 单价/价格/Price)" }, { status: 422 });
  }

  const parsed = toStandardLines(extracted.rows, mapping);
  const rows = extracted.rows;
  const lines = parsed
    .filter((l) => l.mpn)
    .map((l) => ({
      mpn: l.mpn!,
      manufacturer: l.manufacturer,
      unitPrice: String(rows[l.sourceRow - 1]?.[priceCol] ?? "").trim(),
      currency,
      moq: null,
      spq: null,
      leadTimeDays: null,
    }))
    .filter((l) => l.unitPrice !== "");

  if (lines.length === 0) return badRequest("文件中没有可导入的报价行");

  const quote = await importOfflineQuote(auth.session, {
    procurementRfqId: id,
    supplierId,
    currency,
    sourceFileKey: stored.key,
    quotedAt: new Date(),
    lines,
    thresholds,
  });
  if (!quote) return notFound("采购 RFQ 不存在或不属于当前租户");

  return NextResponse.json({ quote, importedLines: lines.length }, { status: 201 });
}
