import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { createIncident, listIncidents } from "@/lib/server/repositories/traceability";

export const runtime = "nodejs";

const Input = z.object({
  code: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(200),
  sourceRef: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  severity: z.string().trim().max(20).nullable().optional(),
});

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "trace.view");
  if (!perm.ok) return perm.response;
  return NextResponse.json({ incidents: await listIncidents(auth.session) });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "trace.analyze");
  if (!perm.ok) return perm.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const inc = await createIncident(auth.session, parsed.data);
  return NextResponse.json({ id: inc.id, code: inc.code }, { status: 201 });
}
