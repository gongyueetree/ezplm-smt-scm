import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { parseEcnLineRows } from "@/lib/domain/ecn";
import { parseCsv, detectDelimiter } from "@/lib/domain/csv";
import { addEcnLines, removeEcnLine } from "@/lib/server/repositories/ecn";

export const runtime = "nodejs";

const LineSchema = z.object({
  oldInternalPn: z.string().trim().max(100).nullable().default(null),
  oldMpn: z.string().trim().max(100).nullable().default(null),
  newInternalPn: z.string().trim().max(100).nullable().default(null),
  newMpn: z.string().trim().max(100).nullable().default(null),
  qtyImpact: z.string().regex(/^-?\d+(\.\d+)?$/).nullable().default(null),
  reason: z.string().trim().max(500).nullable().default(null),
  engineeringNote: z.string().trim().max(500).nullable().default(null),
});

const Input = z.union([
  z.object({ lines: z.array(LineSchema).min(1).max(500) }),
  /** CSV 文本导入(模板列:旧内部料号,旧MPN,新内部料号,新MPN,数量影响,原因,工程备注) */
  z.object({ csvText: z.string().min(1).max(1_000_000) }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ ecnId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PM" || r === "ENGINEERING" || r === "MANAGEMENT")) {
    return forbidden("仅 PM、工程或管理层可维护变更行");
  }
  const { ecnId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  let lines;
  if ("csvText" in parsed.data) {
    const rows = parseCsv(parsed.data.csvText, detectDelimiter(parsed.data.csvText));
    const body = rows.slice(1); // 首行表头
    const out = parseEcnLineRows(body);
    if (out.errors.length > 0) {
      return badRequest(`导入被阻止(逐行报错,好行不静默入库):${out.errors.slice(0, 10).join(";")}`, {
        errors: out.errors,
      });
    }
    if (out.lines.length === 0) return badRequest("没有可导入的变更行");
    lines = out.lines;
  } else {
    const invalid = parsed.data.lines.filter((l) => !l.oldInternalPn && !l.oldMpn);
    if (invalid.length > 0) return badRequest("每行的旧内部料号与旧 MPN 至少填一个");
    lines = parsed.data.lines;
  }

  const r = await addEcnLines(auth.session, ecnId, lines);
  if (!r.ok) return badRequest(r.reason);
  return NextResponse.json({ added: r.added });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ ecnId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { ecnId } = await params;
  const lineId = new URL(req.url).searchParams.get("lineId");
  if (!lineId) return badRequest("缺少 lineId");
  const r = await removeEcnLine(auth.session, ecnId, lineId);
  if (!r.ok) return badRequest(r.reason);
  return NextResponse.json({ ok: true });
}
