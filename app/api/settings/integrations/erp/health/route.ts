import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { connectionHealth } from "@/lib/server/repositories/erp-sync";

export const runtime = "nodejs";

/**
 * ERP 连接健康度(PR-D)。
 *
 * 与「最近一次连接测试结果」不同:健康度看的是**趋势**
 * (连续失败次数、多久没成功、Token 何时到期),
 * 而不是最后一次是否碰巧通了。
 */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.connection.view");
  if (!perm.ok) return perm.response;

  return NextResponse.json({ connections: await connectionHealth(auth.session) });
}
