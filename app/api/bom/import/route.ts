import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  BOM_FIELD_LABELS,
  detectColumnMapping,
  isMappingUsable,
  missingRecommendedFields,
  missingRequiredFields,
  toStandardLines,
} from "@/lib/domain/bom-parse";
import { countUniqueMpns } from "@/lib/domain/bom-parse";
import { shouldUseImportJob } from "@/lib/domain/import-batching";
import { badRequest, requireSession } from "@/lib/server/api";
import { extractRows } from "@/lib/server/file-parse";
import { createImportJob } from "@/lib/server/repositories/bom-import";
import { getStorageProvider } from "@/lib/server/storage";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * BOM 导入:多文件上传 → 原始文件归档 → 解析 → 列映射 → 建 ImportJob。
 * 本请求**不做匹配**;匹配一律走分批(GET /api/bom/import/[jobId]),
 * 满足 SPEC §15「禁止在单个同步请求中处理整张大 BOM」。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("需要 multipart/form-data");

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return badRequest("未选择文件");

  const rfqId = (form.get("rfqId") as string) || null;
  const storage = getStorageProvider();

  const fileKeys: string[] = [];
  const archivedOnly: { fileName: string; reason: string }[] = [];
  /** 每个文件的解析来源与置信度,前端据此区分"解析"与"识别草稿" */
  const extractions: { fileName: string; source: string; isDraft: boolean; note?: string }[] = [];
  let rows: string[][] = [];
  let sourceName = "";
  let sourceKind: string = "none";
  let sourceIsDraft = false;
  let sourceNote: string | undefined;
  const hash = createHash("sha256");

  for (const file of files) {
    if (file.size > MAX_BYTES) return badRequest(`文件 ${file.name} 超过 20MB 上限`);
    const buffer = Buffer.from(await file.arrayBuffer());
    hash.update(buffer);

    // 原始客户文件一律归档(SPEC §6)
    const stored = await storage.put(file.name, buffer, {
      contentType: file.type || "application/octet-stream",
      prefix: `bom-imports/${auth.session.tenantId}`,
    });
    fileKeys.push(stored.key);

    const extracted = await extractRows(file.name, buffer, file.type);
    extractions.push({
      fileName: file.name,
      source: extracted.source,
      isDraft: extracted.isDraft,
      note: extracted.note,
    });
    if (extracted.requiresManualTranscription) {
      archivedOnly.push({ fileName: file.name, reason: extracted.note ?? "无法自动解析" });
      continue;
    }
    if (extracted.rows.length > rows.length) {
      rows = extracted.rows;
      sourceName = file.name;
      sourceKind = extracted.source;
      sourceIsDraft = extracted.isDraft;
      sourceNote = extracted.note;
    }
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          archivedOnly.length > 0
            ? archivedOnly.map((a) => `${a.fileName}:${a.reason}`).join(";")
            : "未能从上传文件中解析出表格内容",
        archivedOnly,
        extractions,
        fileKeys,
        requiresManualTranscription: archivedOnly.length > 0,
      },
      { status: 422 },
    );
  }

  const mapping = detectColumnMapping(rows);
  if (!isMappingUsable(mapping)) {
    return NextResponse.json(
      {
        error: "未能识别必需列,请人工指定列映射",
        missingFields: missingRequiredFields(mapping),
        mapping,
        preview: rows.slice(0, 5),
        fileKeys,
        extractions,
      },
      { status: 422 },
    );
  }

  const lines = toStandardLines(rows, mapping);
  if (lines.length === 0) return badRequest("文件中没有可导入的 BOM 行");

  const { job, validation, bomVersionId } = await createImportJob(auth.session, {
    rfqId,
    bomName: sourceName || files[0].name,
    fileKeys,
    lines,
    idempotencyKey: hash.digest("hex").slice(0, 32),
    columnMapping: mapping,
  });

  const uniqueMpns = countUniqueMpns(lines);
  return NextResponse.json(
    {
      job,
      bomVersionId,
      validation,
      mapping,
      uniqueMpns,
      usesBatching: shouldUseImportJob(uniqueMpns),
      /** 未识别到的建议字段(不阻断导入,但要让人看见) */
      missingRecommended: missingRecommendedFields(mapping).map((f) => BOM_FIELD_LABELS[f]),
      /** 由 Value 列推断出 MPN 的行数(须人工确认) */
      inferredMpnCount: lines.filter((l) => l.mpnSource === "inferred-from-value").length,
      archivedOnly,
      extractions,
      /** 表格来自哪条路径:spreadsheet / pdf-text(确定性)/ ocr(模型草稿) */
      source: sourceKind,
      isDraft: sourceIsDraft,
      sourceNote,
    },
    { status: 201 },
  );
}
