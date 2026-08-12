import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  BOM_FIELD_LABELS,
  detectColumnMapping,
  isMappingUsable,
  missingRequiredFields,
  reconcileImport,
  toStandardLinesTraced,
} from "@/lib/domain/bom-parse";
import { badRequest, requireSession } from "@/lib/server/api";
import { extractRows } from "@/lib/server/file-parse";
import { createImportJob } from "@/lib/server/repositories/bom-import";
import { getStorageProvider } from "@/lib/server/storage";

export const runtime = "nodejs";

/** 一次最多几个文件 —— 超过时明说,不静默只处理前 N 个 */
const MAX_FILES = 20;

/**
 * E4:**预 BOM 批量导入**(客户 Q9)。
 *
 * 与既有的 `/api/bom/import` 的差别只有一条:那边多个文件里**只取行数最多的一个**
 * 当作这份 BOM(其余仅归档),这边**每个文件各自生成一份 BOM / BOMVersion / ImportJob**。
 *
 * **没有第二套 parser** —— 解析、列映射、行去向对账、落库全部复用既有那套。
 * 客户要的是"一次选多个文件",不是另一种解析规则。
 *
 * 用途固定 `PRE_QUOTE`(建 BOM 时的默认值):正式 BOM 只能由预 BOM 转换生成,
 * 这是 PR-C 定下的规矩,批量导入不是绕过它的后门。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("需要 multipart/form-data");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return badRequest("未选择文件");
  if (files.length > MAX_FILES) {
    return badRequest(`一次最多 ${MAX_FILES} 个文件,本次选了 ${files.length} 个 —— 请分批`);
  }
  const rfqId = (form.get("rfqId") as string) || null;

  const storage = getStorageProvider();
  const results: {
    fileName: string;
    ok: boolean;
    reason: string | null;
    bomVersionId: string | null;
    jobId: string | null;
    lines: number;
    reconciliation: ReturnType<typeof reconcileImport> | null;
    idempotentHit: boolean;
  }[] = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await storage.put(file.name, buffer, {
      contentType: file.type || "application/octet-stream",
      prefix: `bom-imports/${auth.session.tenantId}`,
    });

    const extracted = await extractRows(file.name, buffer, file.type);
    if (extracted.rows.length === 0) {
      results.push({
        fileName: file.name,
        ok: false,
        reason: extracted.note ?? "未能从文件里解析出表格内容",
        bomVersionId: null,
        jobId: null,
        lines: 0,
        reconciliation: null,
        idempotentHit: false,
      });
      continue;
    }

    const mapping = detectColumnMapping(extracted.rows);
    if (!isMappingUsable(mapping)) {
      results.push({
        fileName: file.name,
        ok: false,
        reason: `没能认出必需列:${missingRequiredFields(mapping)
          .map((f) => BOM_FIELD_LABELS[f])
          .join("、")}`,
        bomVersionId: null,
        jobId: null,
        lines: 0,
        reconciliation: null,
        idempotentHit: false,
      });
      continue;
    }

    const { lines, trace } = toStandardLinesTraced(extracted.rows, mapping);
    const recon = reconcileImport(trace, lines);
    if (lines.length === 0) {
      results.push({
        fileName: file.name,
        ok: false,
        // 行去向一并带回:「没有可导入的行」与「全被判成待人工」是两回事
        reason: `没有可导入的 BOM 行(原始 ${recon.totalRows} 行,其中待人工判断 ${recon.needsReview} 行)`,
        bomVersionId: null,
        jobId: null,
        lines: 0,
        reconciliation: recon,
        idempotentHit: false,
      });
      continue;
    }

    const idempotencyKey = createHash("sha256")
      .update(buffer)
      .update(
        JSON.stringify(
          lines.map((l) => [l.lineNo, l.refDes, l.qty, l.mpn, l.manufacturer, l.footprint, l.packageCode]),
        ),
      )
      .digest("hex")
      .slice(0, 32);

    const { job, bomVersionId, idempotentHit } = await createImportJob(auth.session, {
      rfqId,
      // 每个文件一份 BOM,名字用**文件名**,批量导入后才分得清哪份是哪份
      bomName: file.name,
      fileKeys: [stored.key],
      fileNames: [file.name],
      lines,
      idempotencyKey,
      columnMapping: mapping,
      trace,
    });

    results.push({
      fileName: file.name,
      ok: true,
      reason: null,
      bomVersionId,
      jobId: job.id,
      lines: lines.length,
      reconciliation: recon,
      idempotentHit: Boolean(idempotentHit),
    });
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json(
    {
      results,
      total: files.length,
      ok: okCount,
      failed: files.length - okCount,
      /*
       * 「用途固定为预 BOM」这句话**两个分支都要有**。
       * 只在全成功时说,恰恰是部分失败、人最需要弄清状态的时候没了 ——
       * 与 #44 那次「口径说明只在有数据时才出现」是同一类错误。
       * 顺带不带 markdown 星号:这段直接显示在页面上,`**` 会露成星号。
       */
      note:
        okCount === files.length
          ? `${okCount} 个文件各自生成了一份预 BOM(用途 PRE_QUOTE)。正式 BOM 需由预 BOM 转换生成。`
          : `${okCount}/${files.length} 个文件导入成功,各自生成一份预 BOM(用途 PRE_QUOTE);` +
            `失败的原因逐个列在下方,已成功的不必重传。`,
    },
    { status: 201 },
  );
}
