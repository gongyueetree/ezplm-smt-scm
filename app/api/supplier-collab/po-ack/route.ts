import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  poNo: z.string().trim().min(1),
  decision: z.enum(["ACCEPTED", "REJECTED", "PARTIAL"]),
  note: z.string().trim().max(500).nullable().optional(),
  source: z.enum(["EMAIL_MANUAL", "PORTAL", "PHONE"]).optional(),
});

/**
 * 订单接受通知登记(客户 docx:「订单接受通知」)。
 *
 * 供应商的接单确认目前只能**人工登记**(邮件回复/电话),
 * 记录里如实写明来源渠道 —— 不假装系统自动收到了回执。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可登记接单回执");
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const po = await prisma.purchaseOrder.findFirst({
    where: tenantWhere(auth.session.tenantId, { poNo: parsed.data.poNo }),
    select: { id: true, supplierId: true, status: true },
  });
  if (!po) return notFound("采购订单不存在或不属于当前租户");
  if (po.status !== "APPROVED" && po.status !== "EXPORTED") {
    return NextResponse.json(
      { error: `订单状态为 ${po.status},未审批的订单不应有供应商回执` },
      { status: 422 },
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.poAcknowledgement.upsert({
      where: {
        tenantId_poNo_supplierId: {
          tenantId: auth.session.tenantId,
          poNo: parsed.data.poNo,
          supplierId: po.supplierId,
        },
      },
      update: {
        decision: parsed.data.decision,
        note: parsed.data.note ?? null,
        source: parsed.data.source ?? "EMAIL_MANUAL",
        recordedById: auth.session.userId,
        recordedAt: new Date(),
      },
      create: tenantData(auth.session.tenantId, {
        poNo: parsed.data.poNo,
        supplierId: po.supplierId,
        decision: parsed.data.decision,
        note: parsed.data.note ?? null,
        source: parsed.data.source ?? "EMAIL_MANUAL",
        recordedById: auth.session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "PO_ACK_RECORD",
      entityType: "PoAcknowledgement",
      entityId: saved.id,
      after: { poNo: parsed.data.poNo, decision: parsed.data.decision, source: saved.source },
    });
    return saved;
  });

  return NextResponse.json({ ok: true, id: row.id });
}
