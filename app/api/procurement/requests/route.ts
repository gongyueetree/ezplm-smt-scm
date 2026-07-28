import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import {
  createPurchaseRequest,
  listPurchaseRequests,
  previewGtb,
} from "@/lib/server/repositories/purchase-request";

export const runtime = "nodejs";

const Input = z.object({
  mpn: z.string().min(1),
  demandQty: z.number().positive(),
  scrapRate: z.string().nullable().optional(),
  moq: z.number().int().nonnegative().nullable().optional(),
  spq: z.number().int().nonnegative().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  /** true = 只试算不落库 */
  previewOnly: z.boolean().optional(),
});

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listPurchaseRequests(auth.session) });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  if (parsed.data.previewOnly) {
    return NextResponse.json({ preview: await previewGtb(auth.session.tenantId, parsed.data) });
  }
  const pr = await createPurchaseRequest(auth.session, parsed.data);
  return NextResponse.json({ purchaseRequest: pr }, { status: 201 });
}
