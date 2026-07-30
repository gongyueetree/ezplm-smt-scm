import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import {
  createPurchaseOrder,
  listPurchaseOrders,
} from "@/lib/server/repositories/purchase-order";
import { PO_STATUSES } from "@/lib/domain/po-status";

export const runtime = "nodejs";

const LineSchema = z.object({
  lineNo: z.number().int().positive(),
  mpn: z.string().trim().max(100).nullable().optional(),
  manufacturer: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  qty: z.string().min(1),
  unitPrice: z.string().nullable().optional(),
  currency: z.string().trim().length(3).nullable().optional(),
  moq: z.number().int().nonnegative().nullable().optional(),
  spq: z.number().int().nonnegative().nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  requestDate: z.string().nullable().optional(),
  sourcingMode: z.enum(["SPOT", "FUTURES"]).nullable().optional(),
});

const CreateSchema = z.object({
  poNo: z.string().trim().min(1).max(50),
  supplierId: z.string().trim().min(1),
  currency: z.string().trim().length(3).optional(),
  procurementRfqId: z.string().nullable().optional(),
  purchaseRequestId: z.string().nullable().optional(),
  lines: z.array(LineSchema).max(500).optional(),
});

function assertProcurement(roles: readonly string[]) {
  return roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT");
}

export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  if (status && !PO_STATUSES.includes(status as (typeof PO_STATUSES)[number])) {
    return badRequest("status 不合法");
  }
  const orders = await listPurchaseOrders(auth.session, {
    status: (status as (typeof PO_STATUSES)[number] | null) ?? null,
    supplierId: url.searchParams.get("supplierId"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!assertProcurement(auth.session.roles)) return forbidden("仅采购或管理层可创建采购订单");

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const po = await createPurchaseOrder(auth.session, parsed.data);
  return NextResponse.json({ id: po.id, poNo: po.poNo }, { status: 201 });
}
