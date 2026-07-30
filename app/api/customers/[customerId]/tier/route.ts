import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/** 设置客户等级;**清空 = 未评级**,不等于 C 级 */
const Input = z.object({ tier: z.enum(["A", "B", "C"]).nullable() });

export async function POST(req: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "MANAGEMENT" || r === "PM")) {
    return forbidden("仅 PM 或管理层可维护客户等级");
  }
  const { customerId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法(等级只能是 A/B/C 或留空)");

  const customer = await prisma.customer.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: customerId }),
    select: { id: true, tier: true },
  });
  if (!customer) return notFound();

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: customerId }, data: { tier: parsed.data.tier } });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "CUSTOMER_TIER_SET",
      entityType: "Customer",
      entityId: customerId,
      before: { tier: customer.tier },
      after: { tier: parsed.data.tier },
    });
  });
  return NextResponse.json({ ok: true });
}
