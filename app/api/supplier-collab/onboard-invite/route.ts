import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { buildSupplierOnboardDraft } from "@/lib/domain/email-draft";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData } from "@/lib/server/tenant-scope";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const Input = z.object({
  companyName: z.string().trim().max(120).nullable().optional(),
  toEmail: z.string().trim().email().nullable().optional(),
  supplierId: z.string().trim().nullable().optional(),
  /** 邀请有效天数;留空 = 不设期限 */
  validDays: z.number().int().positive().max(365).nullable().optional(),
});

/**
 * 供应商建档邀请(客户 docx:「供应商的资料是否可以在添加供应商时由供应商直接邮件发出」)。
 *
 * 一期:生成邀请链接 + 邮件草稿。**系统不发邮件**;
 * 供应商提交的资料先落 submitted,**复核通过前不进主数据**。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可发起供应商建档邀请");
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法(邮箱格式需正确)");

  const token = randomBytes(24).toString("base64url");
  const expiresAt = parsed.data.validDays
    ? new Date(Date.now() + parsed.data.validDays * 86_400_000)
    : null;

  const origin = new URL(req.url).origin;
  const inviteUrl = `${origin}/onboard/${token}`;
  const tenant = await prisma.tenant.findFirst({
    where: { id: auth.session.tenantId },
    select: { name: true },
  });

  const draft = buildSupplierOnboardDraft({
    companyName: parsed.data.companyName ?? null,
    inviteUrl,
    expiresAt: expiresAt?.toISOString() ?? null,
    sellerName: tenant?.name ?? "本公司",
  });

  const result = await prisma.$transaction(async (tx) => {
    const invite = await tx.supplierOnboardInvite.create({
      data: tenantData(auth.session.tenantId, {
        supplierId: parsed.data.supplierId ?? null,
        token,
        toEmail: parsed.data.toEmail ?? null,
        companyName: parsed.data.companyName ?? null,
        expiresAt,
        createdById: auth.session.userId,
      }),
    });
    const email = await tx.emailDraft.create({
      data: tenantData(auth.session.tenantId, {
        kind: "SUPPLIER_ONBOARD",
        refType: "SupplierOnboardInvite",
        refId: invite.id,
        toEmail: parsed.data.toEmail ?? null,
        toName: parsed.data.companyName ?? null,
        subject: draft.subject,
        body: draft.body,
        attachments: [] as unknown as Prisma.InputJsonValue,
        createdById: auth.session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "SUPPLIER_ONBOARD_INVITE",
      entityType: "SupplierOnboardInvite",
      entityId: invite.id,
      after: { toEmail: parsed.data.toEmail ?? null, note: "已生成邀请与邮件草稿,系统未发送" },
    });
    return { invite, email };
  });

  return NextResponse.json(
    {
      inviteId: result.invite.id,
      inviteUrl,
      draftId: result.email.id,
      note: "已生成邀请链接与邮件草稿;邮件通道未接入,系统未发送任何邮件",
    },
    { status: 201 },
  );
}
