import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/api";
import { loadAttributeDefinitions } from "@/lib/server/repositories/part-create";

export const runtime = "nodejs";

/** 分类驱动的动态参数模板:选完分类后由前端拉取 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const defs = await loadAttributeDefinitions(
    auth.session,
    url.searchParams.get("categoryL1"),
    url.searchParams.get("categoryL2"),
  );
  return NextResponse.json({ definitions: defs });
}
