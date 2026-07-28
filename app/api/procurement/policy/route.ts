import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import {
  getProcurementPolicy,
  saveProcurementPolicy,
} from "@/lib/server/repositories/procurement-policy";

export const runtime = "nodejs";

const Input = z.object({
  currency: z.string().length(3),
  maxUnitPrice: z.string().nullable(),
  maxLeadTimeDays: z.number().int().positive().nullable(),
  confirmedByBusiness: z.boolean(),
});

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ policy: await getProcurementPolicy(auth.session.tenantId) });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可维护采购策略");
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  await saveProcurementPolicy(auth.session, parsed.data);
  return NextResponse.json({ policy: await getProcurementPolicy(auth.session.tenantId) });
}
