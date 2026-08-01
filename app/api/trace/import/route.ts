import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { importTraceTemplate } from "@/lib/server/repositories/traceability";

export const runtime = "nodejs";

const Input = z.object({
  template: z.enum(["RECEIPT", "WO_ISSUE", "SHIPMENT"]),
  text: z.string().min(1).max(2_000_000),
  fileName: z.string().max(200).nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "trace.import");
  if (!perm.ok) return perm.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const r = await importTraceTemplate(
    auth.session,
    parsed.data.template,
    parsed.data.text,
    parsed.data.fileName,
  );
  if (!r.ok) {
    return NextResponse.json({ error: r.reason, errors: r.errors, notices: r.notices }, { status: 422 });
  }
  return NextResponse.json(r, { status: 201 });
}
