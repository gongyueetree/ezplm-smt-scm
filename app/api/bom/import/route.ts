import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  BOM_FIELD_LABELS,
  detectColumnMapping,
  isMappingUsable,
  missingRecommendedFields,
  missingRequiredFields,
  toStandardLinesTraced,
} from "@/lib/domain/bom-parse";
import { countUniqueMpns, reconcileImport } from "@/lib/domain/bom-parse";
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
        /*
         * D-4(客户 PR2 反馈 工程-1):原文案是「未能识别必需列,请人工指定列映射」——
         * 但系统**根本没有**人工指定列映射的入口,客户照做无门,只好怀疑
         * 是不是格式不兼容。承诺一个不存在的动作比不给提示更糟。
         * 改为说清缺什么、怎么办;缺哪几列、识别到了什么、前几行长什么样
         * 都已在下面返回,由前端展示。
         */
        error:
          "没能从表头认出「数量」列 —— 这不是格式不兼容,文件已经读进来了,只是列名不认识。" +
          "请把数量列的表头改成「数量」「用量」「Qty」之一后重新上传。",
        // 用中文标签,不要把内部字段名(qty/mpn)甩给客户
        missingFields: missingRequiredFields(mapping).map((f) => BOM_FIELD_LABELS[f]),
        // 已经认出来的列 —— 让人一眼看出"认出了这些、就差数量",而不是以为整份没读懂
        detectedFields: Object.entries(mapping.fields)
          .filter(([, idx]) => idx !== undefined)
          .map(([f]) => BOM_FIELD_LABELS[f as keyof typeof BOM_FIELD_LABELS] ?? f),
        mapping,
        preview: rows.slice(0, 5),
        fileKeys,
        extractions,
      },
      { status: 422 },
    );
  }

  // E1a:解析时**一并拿到每一行的去向**,后面与作业同事务落库
  const { lines, trace } = toStandardLinesTraced(rows, mapping);
  if (lines.length === 0) {
    /*
     * 一行都没识别出来时,也要把行去向带回去 ——
     * 「文件里没有可导入的行」和「100 行全被判成待人工」是两回事,
     * 只给一句错误提示,用户没法判断是自己文件的问题还是系统的问题。
     */
    return NextResponse.json(
      {
        error: "文件中没有可导入的 BOM 行",
        reconciliation: reconcileImport(trace, lines),
        unresolvedRows: trace
          .filter((t) => t.disposition === "NO_IDENTIFIER" || t.disposition === "INSUFFICIENT")
          .slice(0, 50),
      },
      { status: 422 },
    );
  }

  /*
   * 幂等键 = 文件内容 + **解析结果**。
   * 只用文件字节的话,解析器一升级,重传同一份文件仍会命中旧作业,
   * 用户永远看不到新解析出来的信息(见 createImportJob 里的说明)。
   */
  const idempotencyKey = createHash("sha256")
    .update(hash.digest())
    .update(
      JSON.stringify(
        lines.map((l) => [l.lineNo, l.refDes, l.qty, l.mpn, l.manufacturer, l.footprint, l.packageCode]),
      ),
    )
    .digest("hex")
    .slice(0, 32);

  const { job, validation, bomVersionId, idempotentHit } = await createImportJob(auth.session, {
    rfqId,
    bomName: sourceName || files[0].name,
    fileKeys,
    fileNames: files.map((f) => f.name),
    lines,
    idempotencyKey,
    columnMapping: mapping,
    trace,
  });

  const uniqueMpns = countUniqueMpns(lines);
  return NextResponse.json(
    {
      job,
      bomVersionId,
      validation,
      mapping,
      uniqueMpns,
      /**
       * E1a:行去向对账。客户 Q13 的验收口径 ——
       * 「100 行进去只剩 92 行,另外 8 行去哪了」必须当场答得上来。
       */
      reconciliation: reconcileImport(trace, lines),
      usesBatching: shouldUseImportJob(uniqueMpns),
      /** 未识别到的建议字段(不阻断导入,但要让人看见) */
      missingRecommended: missingRecommendedFields(mapping).map((f) => BOM_FIELD_LABELS[f]),
      /** 由 Value 列推断出 MPN 的行数(须人工确认) */
      inferredMpnCount: lines.filter((l) => l.mpnSource === "inferred-from-value").length,
      /** 命中幂等:内容与既有版本完全一致,直接复用,未新建版本 */
      idempotentHit: idempotentHit ?? null,
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
