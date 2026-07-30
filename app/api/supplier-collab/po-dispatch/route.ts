import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { buildPoDispatchDraft } from "@/lib/domain/email-draft";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const Input = z.object({ purchaseOrderIds: z.array(z.string().min(1)).min(1).max(50) });

/**
 * 批量发送订单(客户 docx:「批量发送订单」)。
 *
 * ⚠ 邮件通道未接入 —— 本接口**批量生成邮件草稿**,不发送任何邮件。
 * 只允许对**已审批**的订单生成,避免把草稿单发给供应商。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可生成订单邮件草稿");
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const orders = await prisma.purchaseOrder.findMany({
    where: tenantWhere(auth.session.tenantId, { id: { in: parsed.data.purchaseOrderIds } }),
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });

  const supplierIds = [...new Set(orders.map((o) => o.supplierId))];
  const suppliers = await prisma.supplier.findMany({
    where: tenantWhere(auth.session.tenantId, { id: { in: supplierIds } }),
    include: {
      contacts: { where: { isPrimary: true }, take: 1 },
    },
  });
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const tenant = await prisma.tenant.findFirst({ where: { id: auth.session.tenantId }, select: { name: true } });

  const created: { poNo: string; ok: boolean; reason?: string }[] = [];

  for (const po of orders) {
    if (po.status !== "APPROVED" && po.status !== "EXPORTED") {
      created.push({ poNo: po.poNo, ok: false, reason: `订单状态为 ${po.status},未审批不得发给供应商` });
      continue;
    }
    const sup = supplierById.get(po.supplierId);
    const contact = sup?.contacts[0] ?? null;
    const draft = buildPoDispatchDraft({
      poNo: po.poNo,
      supplierName: sup?.name ?? po.supplierId,
      contactName: contact?.name ?? null,
      currency: po.currency,
      lines: po.lines.map((l) => ({
        lineNo: l.lineNo,
        mpn: l.mpn,
        qty: l.qty.toString(),
        requestDate: l.requestDate?.toISOString() ?? null,
      })),
      attachments: [`ERP 批量下单模板 ${po.poNo}.xlsx`],
      sellerName: tenant?.name ?? "本公司",
    });

    await prisma.$transaction(async (tx) => {
      const row = await tx.emailDraft.create({
        data: tenantData(auth.session.tenantId, {
          kind: "PO_DISPATCH",
          refType: "PurchaseOrder",
          refId: po.id,
          toName: contact?.name ?? sup?.name ?? null,
          toEmail: contact?.email ?? null,
          subject: draft.subject,
          body: draft.body,
          attachments: draft.attachments as unknown as Prisma.InputJsonValue,
          createdById: auth.session.userId,
        }),
      });
      await writeAudit(tx, {
        tenantId: auth.session.tenantId,
        userId: auth.session.userId,
        action: "EMAIL_DRAFT_CREATE",
        entityType: "EmailDraft",
        entityId: row.id,
        after: { kind: "PO_DISPATCH", poNo: po.poNo, note: "仅生成草稿,系统未发送" },
      });
    });
    created.push({ poNo: po.poNo, ok: true });
  }

  return NextResponse.json({
    drafts: created,
    note: "已生成邮件草稿;邮件通道未接入,系统未发送任何邮件",
  });
}
