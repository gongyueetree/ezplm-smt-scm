import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { checkCallQty, checkShortageTransition } from "@/lib/domain/shortage-sheet";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  callQty: z.string().min(1),
  supplierId: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/**
 * PR2-PROC-10:采购填 Call 料数量 → 生成 Call 料记录 + 邮件草稿。
 *
 * 客户要的链路:缺料行 → Call 料记录 → 供应商 → 邮件/发送记录。
 *
 * **邮件通道尚未接通**(OPEN-QUESTIONS Q3:SMTP 参数未提供),
 * 所以这里只生成草稿,`emailState` 固定为 `DRAFT`,界面显示
 * 「待发送 / 邮件草稿已生成」。**绝不写 SENT,也绝不显示「已发送」** ——
 * 采购据此以为催过了却其实没发,是会误事的。
 */
export async function POST(req: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("Call 料由采购发起");
  }
  const { lineId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const line = await prisma.shortageSheetLine.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: lineId }),
  });
  if (!line) return notFound("缺料行不存在或不属于当前租户");

  const qtyCheck = checkCallQty(parsed.data.callQty, line.shortageQty.toString());
  if (!qtyCheck.ok) return badRequest(qtyCheck.message);

  const transition = checkShortageTransition(
    line.status as "OPEN",
    "CALL_CREATED",
  );
  if (!transition.ok) {
    return NextResponse.json({ error: transition.message }, { status: 422 });
  }

  const supplierId = parsed.data.supplierId ?? line.supplierId;
  const supplier = supplierId
    ? await prisma.supplier.findFirst({
        where: tenantWhere(auth.session.tenantId, { id: supplierId }),
        include: { contacts: { select: { email: true } } },
      })
    : null;

  // 收件人取供应商联系人邮箱;没有就留空,草稿里如实标注"待补收件人"
  const toEmails = (supplier?.contacts ?? [])
    .map((c) => c.email)
    .filter((e): e is string => !!e);

  const subject = `【催料】${line.mpn ?? line.internalPn ?? "物料"} 需 ${parsed.data.callQty}`;
  const body = [
    `${supplier?.name ?? "供应商"} 您好:`,
    ``,
    `我司现需以下物料,请回复可供数量与最早交期:`,
    `  料号:${line.internalPn ?? "-"}`,
    `  MPN :${line.mpn ?? "-"}`,
    `  制造商:${line.manufacturer ?? "-"}`,
    `  需求数量:${parsed.data.callQty}`,
    line.requiredDate ? `  需求日期:${line.requiredDate.toISOString().slice(0, 10)}` : "",
    parsed.data.note ? `  备注:${parsed.data.note}` : "",
    ``,
    `谢谢。`,
  ]
    .filter(Boolean)
    .join("\n");

  const record = await prisma.$transaction(async (tx) => {
    const r = await tx.callMaterialRecord.create({
      data: tenantData(auth.session.tenantId, {
        lineId: line.id,
        supplierId: supplier?.id ?? null,
        callQty: parsed.data.callQty,
        // 没有 SMTP → 停在 DRAFT。不设默认 SENT,也没有任何分支能把它写成 SENT。
        emailState: "DRAFT",
        emailSubject: subject,
        emailBody: body,
        toEmails,
        createdById: auth.session.userId,
      }),
    });
    await tx.shortageSheetLine.updateMany({
      where: tenantWhere(auth.session.tenantId, { id: line.id }),
      data: { callQty: parsed.data.callQty, supplierId: supplier?.id ?? line.supplierId, status: "CALL_CREATED" },
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "SHORTAGE_CALL_CREATED",
      entityType: "ShortageSheetLine",
      entityId: line.id,
      before: { status: line.status, callQty: line.callQty?.toString() ?? null },
      after: {
        status: "CALL_CREATED",
        callQty: parsed.data.callQty,
        supplier: supplier?.name ?? null,
        emailState: "DRAFT",
        recipientCount: toEmails.length,
      },
    });
    return r;
  });

  return NextResponse.json(
    {
      callRecord: record,
      /*
       * 回执措辞是诚实 UI 的落点:说「草稿已生成」,不说「已发送」。
       * 收件人为空时额外点明,免得人以为发得出去。
       */
      note:
        toEmails.length === 0
          ? "Call 料记录已建立,邮件草稿已生成、尚未发送 —— 该供应商没有联系人邮箱,补齐后才能发送;邮件通道也待接入(SMTP 未配置)"
          : "Call 料记录已建立,邮件草稿已生成、尚未发送 —— 邮件通道待接入(SMTP 未配置)",
    },
    { status: 201 },
  );
}
