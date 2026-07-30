import { NextResponse } from "next/server";
import { notFound, requireSession } from "@/lib/server/api";
import { getPurchaseOrder } from "@/lib/server/repositories/purchase-order";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ poId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { poId } = await params;
  const po = await getPurchaseOrder(auth.session, poId);
  if (!po) return notFound();
  return NextResponse.json({ order: po });
}
