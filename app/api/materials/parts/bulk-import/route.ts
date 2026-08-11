import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import {
  parsePartImport,
  parsePartImportGrid,
  planImport,
  type PartImportParseResult,
} from "@/lib/domain/part-bulk-import";
import { extractRows } from "@/lib/server/file-parse";
import { requirePermission } from "@/lib/server/permissions";
import { bulkCreateParts, loadExistingKeys } from "@/lib/server/repositories/part-create";

export const runtime = "nodejs";

const Input = z.object({
  text: z.string().min(1).max(2_000_000),
  /** PREVIEW = 只出计划不写库;EXECUTE = 真正创建 */
  mode: z.enum(["PREVIEW", "EXECUTE"]).default("PREVIEW"),
  /** 执行时是否连疑似重复行一起建(默认不建 —— 疑似重复必须人工确认) */
  includeSuspected: z.boolean().optional(),
});

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "material.create");
  if (!perm.ok) return perm.response;

  /*
   * N-3(客户 PR2 反馈 采购-1d:「批量导入物料以附件(比如 xls)选择进行,不以文本形式进行导入」)。
   *
   * 两条入口共存:
   *   - multipart/form-data → 上传 xlsx/csv 文件(客户要的形态);
   *   - application/json    → 粘贴文本(原有形态,不删)。
   * 二者拿到网格后走**同一条**列映射 + 校验 + 人工确认链路 ——
   * 为附件另写一套解析,迟早会在"同一份数据两种结论"上分叉。
   */
  const contentType = req.headers.get("content-type") ?? "";
  let mode: "PREVIEW" | "EXECUTE" = "PREVIEW";
  let includeSuspected = false;
  let file: PartImportParseResult;
  let sourceNote: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return badRequest("需要 multipart/form-data");
    const upload = form.get("file");
    if (!(upload instanceof File)) return badRequest("未选择文件");
    mode = form.get("mode") === "EXECUTE" ? "EXECUTE" : "PREVIEW";
    includeSuspected = form.get("includeSuspected") === "true";

    const buffer = Buffer.from(await upload.arrayBuffer());
    const extracted = await extractRows(upload.name, buffer, upload.type);
    if (extracted.rows.length === 0) {
      return NextResponse.json(
        {
          error: extracted.note ?? `${upload.name}:未能从文件中解析出表格内容`,
          requiresManualTranscription: extracted.requiresManualTranscription,
        },
        { status: 422 },
      );
    }
    /*
     * OCR / PDF 文本层是**转写草稿**,不是确定性解析。这里如实带出来,
     * 由前端提示逐行核对 —— 绝不把识别结果当成读进来的表格。
     */
    if (extracted.isDraft || extracted.source === "ocr") {
      sourceNote =
        `内容来自${extracted.source === "ocr" ? "图片识别" : "PDF 文本层重建"},属**草稿**,` +
        `请逐行核对后再执行导入。`;
    }
    file = parsePartImportGrid(extracted.rows);
  } else {
    const parsed = Input.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest("请求参数不合法");
    mode = parsed.data.mode;
    includeSuspected = parsed.data.includeSuspected ?? false;
    file = parsePartImport(parsed.data.text);
  }

  if (file.rows.length === 0) {
    return NextResponse.json(
      { error: "没有可导入的数据行", errors: file.errors, notices: file.notices },
      { status: 422 },
    );
  }

  const existing = await loadExistingKeys(auth.session);
  const plan = planImport(file.rows, existing);

  if (mode === "PREVIEW") {
    return NextResponse.json({
      mode: "PREVIEW",
      plan,
      errors: file.errors,
      notices: sourceNote ? [sourceNote, ...file.notices] : file.notices,
      note: "预览只计算计划,**未创建任何物料**",
    });
  }

  const created = await bulkCreateParts(auth.session, file.rows, plan, includeSuspected);
  return NextResponse.json(
    {
      mode: "EXECUTE",
      plan,
      created: created.count,
      skipped: created.skipped,
      errors: file.errors,
      notices: sourceNote ? [sourceNote, ...file.notices] : file.notices,
      note: created.note,
    },
    { status: 201 },
  );
}
