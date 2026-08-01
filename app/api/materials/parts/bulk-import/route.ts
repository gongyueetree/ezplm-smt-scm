import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { parsePartImport, planImport } from "@/lib/domain/part-bulk-import";
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

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const file = parsePartImport(parsed.data.text);
  if (file.rows.length === 0) {
    return NextResponse.json(
      { error: "没有可导入的数据行", errors: file.errors, notices: file.notices },
      { status: 422 },
    );
  }

  const existing = await loadExistingKeys(auth.session);
  const plan = planImport(file.rows, existing);

  if (parsed.data.mode === "PREVIEW") {
    return NextResponse.json({
      mode: "PREVIEW",
      plan,
      errors: file.errors,
      notices: file.notices,
      note: "预览只计算计划,**未创建任何物料**",
    });
  }

  const created = await bulkCreateParts(
    auth.session,
    file.rows,
    plan,
    parsed.data.includeSuspected ?? false,
  );
  return NextResponse.json(
    {
      mode: "EXECUTE",
      plan,
      created: created.count,
      skipped: created.skipped,
      errors: file.errors,
      notices: file.notices,
      note: created.note,
    },
    { status: 201 },
  );
}
