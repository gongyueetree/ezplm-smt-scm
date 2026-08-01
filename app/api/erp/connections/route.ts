import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { createConnection, listConnections } from "@/lib/server/repositories/erp-connection";

export const runtime = "nodejs";

const Input = z.object({
  name: z.string().trim().min(1).max(60),
  vendor: z.enum(["KINGDEE", "YONYOU", "SAP", "ORACLE", "EXCEL", "MOCK"]),
  edition: z.string().trim().max(40).nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  syncCron: z.string().trim().max(60).nullable().optional(),
  /** 明文凭据:服务端加密保存,**响应不回传** */
  secrets: z.record(z.string(), z.string()).optional(),
});

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.connection.view");
  if (!perm.ok) return perm.response;
  return NextResponse.json({ connections: await listConnections(auth.session) });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.connection.manage");
  if (!perm.ok) return perm.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const r = await createConnection(auth.session, parsed.data);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json({ id: r.id }, { status: 201 });
}
