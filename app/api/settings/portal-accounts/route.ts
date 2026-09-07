import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildActivateUrl,
  generateActionToken,
  inviteExpiry,
  tokenAuditRef,
} from "@/lib/domain/portal-invite";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  customerId: z.string().min(1),
  email: z.string().trim().email().max(160),
});

/**
 * F6-B → R3-3:门户账号邀请(仅内部 MANAGEMENT;无自注册路径)。
 * **直发密码路径已下线**:管理员不再代设初始密码 —— 建号即 INVITED,
 * 返回一次性激活链接(原始 token 仅此一次出现),客户自设密码后 ACTIVE。
 * SMTP 未配置属常态:UI 提供「复制链接」,绝不显示「邮件已发送」。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.includes("MANAGEMENT")) return forbidden("仅管理层可邀请门户账号");

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  const customer = await prisma.customer.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: parsed.data.customerId }),
    select: { id: true, name: true },
  });
  if (!customer) return badRequest("客户不存在或不属于当前租户");

  const existing = await prisma.portalAccount.findFirst({
    where: tenantWhere(auth.session.tenantId, { email: parsed.data.email }),
  });
  if (existing) return badRequest("该邮箱已有门户账号(重发激活请用「重新邀请」)");

  const token = generateActionToken();
  const expiresAt = inviteExpiry();
  const account = await prisma.$transaction(async (tx) => {
    const acc = await tx.portalAccount.create({
      data: tenantData(auth.session.tenantId, {
        customerId: customer.id,
        email: parsed.data.email,
        passwordHash: null,
        status: "INVITED",
        active: true,
        invitedById: auth.session.userId,
      }),
    });
    await tx.portalInvite.create({
      data: tenantData(auth.session.tenantId, {
        accountId: acc.id,
        tokenHash: token.hash,
        expiresAt,
        createdById: auth.session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "PORTAL_ACCOUNT_INVITE",
      entityType: "PortalAccount",
      entityId: acc.id,
      after: {
        email: acc.email,
        customer: customer.name,
        tokenRef: tokenAuditRef(token.hash),
        expiresAt: expiresAt.toISOString(),
      },
    });
    return acc;
  });

  const link = buildActivateUrl(token.raw, process.env.APP_PUBLIC_URL, process.env.NEXT_PUBLIC_BASE_PATH ?? "");
  return NextResponse.json(
    {
      ok: true,
      accountId: account.id,
      status: "INVITED",
      // 原始 token 仅出现在本响应;库里只有 SHA-256
      activateUrl: link.url,
      absolute: link.absolute,
      expiresAt: expiresAt.toISOString(),
      note: link.absolute
        ? "请把链接交给客户(7 天内有效,单次使用)"
        : "APP_PUBLIC_URL 未配置,链接为相对路径 —— 外发前请补全域名",
    },
    { status: 201 },
  );
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.includes("MANAGEMENT")) return forbidden("仅管理层可查看门户账号");
  const accounts = await prisma.portalAccount.findMany({
    where: tenantWhere(auth.session.tenantId),
    select: {
      id: true,
      email: true,
      customerId: true,
      status: true,
      passwordChangedAt: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ accounts });
}
