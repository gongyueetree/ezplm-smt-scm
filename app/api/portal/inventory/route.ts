import { NextResponse } from "next/server";
import { portalInventory, requirePortalSession } from "@/lib/server/portal";

export const runtime = "nodejs";

/** F6-B:我的库存(customer scope 由会话决定,无参数可传 —— 无法请求别家数据) */
export async function GET() {
  const auth = await requirePortalSession();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await portalInventory(auth.session));
}
