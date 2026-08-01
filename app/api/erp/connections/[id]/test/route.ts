import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { testConnection } from "@/lib/server/repositories/erp-connection";

export const runtime = "nodejs";

/**
 * 真实连接测试。**不是固定绿灯** —— 结果由 Provider 真实返回决定,
 * 状态 CONNECTED 只在 ok=true 且有可用能力时才会写入。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.connection.manage");
  if (!perm.ok) return perm.response;

  const { id } = await params;
  const r = await testConnection(auth.session, id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 404 });
  return NextResponse.json({ status: r.status, result: r.result });
}
