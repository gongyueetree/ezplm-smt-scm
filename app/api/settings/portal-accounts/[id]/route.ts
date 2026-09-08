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

const PatchInput = z.object({ action: z.enum(["disable", "enable", "reinvite"]) });

/**
 * R3-3:门户账号管理(仅内部 MANAGEMENT)。
 * - disable:即时停用(status=DISABLED + active=false,会话守卫逐请求查,立刻生效),
 *   并撤销所有未用邀请;
 * - enable:恢复 —— 已设过密码 → ACTIVE;从未设密码 → 回 INVITED(需重新邀请);
 * - reinvite:撤销旧邀请、发新一次性激活链接。已 ACTIVE 的账号也可用
 *   (= 管理员发起的密码重置:客户经新链接自设新密码,管理员依然不知道密码)。
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.includes("MANAGEMENT")) return forbidden("仅管理层可管理门户账号");

  const parsed = PatchInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法(action: disable/enable/reinvite)");

  const { id } = await params;
  const account = await prisma.portalAccount.findFirst({
    where: tenantWhere(auth.session.tenantId, { id }),
  });
  if (!account) return badRequest("门户账号不存在或不属于当前租户");

  const tenantId = auth.session.tenantId;
  const userId = auth.session.userId;

  if (parsed.data.action === "disable") {
    await prisma.$transaction(async (tx) => {
      await tx.portalAccount.update({
        where: { id: account.id },
        data: { status: "DISABLED", active: false },
      });
      await tx.portalInvite.updateMany({
        where: tenantWhere(tenantId, { accountId: account.id, status: "PENDING" as const }),
        data: { status: "REVOKED" },
      });
      await writeAudit(tx, {
        tenantId,
        userId,
        action: "PORTAL_ACCOUNT_DISABLE",
        entityType: "PortalAccount",
        entityId: account.id,
        before: { status: account.status },
        after: { status: "DISABLED", pendingInvitesRevoked: true },
      });
    });
    return NextResponse.json({ ok: true, status: "DISABLED" });
  }

  if (parsed.data.action === "enable") {
    const nextStatus = account.passwordHash ? "ACTIVE" : "INVITED";
    await prisma.$transaction(async (tx) => {
      await tx.portalAccount.update({
        where: { id: account.id },
        data: { status: nextStatus, active: true },
      });
      await writeAudit(tx, {
        tenantId,
        userId,
        action: "PORTAL_ACCOUNT_ENABLE",
        entityType: "PortalAccount",
        entityId: account.id,
        before: { status: account.status },
        after: { status: nextStatus },
      });
    });
    return NextResponse.json({
      ok: true,
      status: nextStatus,
      ...(nextStatus === "INVITED" ? { note: "该账号从未设置密码,请用「重新邀请」发激活链接" } : {}),
    });
  }

  // reinvite
  if (account.status === "DISABLED") {
    return badRequest("账号已停用 —— 请先启用再重新邀请");
  }
  const token = generateActionToken();
  const expiresAt = inviteExpiry();
  await prisma.$transaction(async (tx) => {
    await tx.portalInvite.updateMany({
      where: tenantWhere(tenantId, { accountId: account.id, status: "PENDING" as const }),
      data: { status: "REVOKED" },
    });
    await tx.portalInvite.create({
      data: tenantData(tenantId, {
        accountId: account.id,
        tokenHash: token.hash,
        expiresAt,
        createdById: userId,
      }),
    });
    await writeAudit(tx, {
      tenantId,
      userId,
      action: "PORTAL_ACCOUNT_REINVITE",
      entityType: "PortalAccount",
      entityId: account.id,
      after: {
        email: account.email,
        tokenRef: tokenAuditRef(token.hash),
        expiresAt: expiresAt.toISOString(),
        priorStatus: account.status,
      },
    });
  });
  const link = buildActivateUrl(token.raw, process.env.APP_PUBLIC_URL, process.env.NEXT_PUBLIC_BASE_PATH ?? "");
  return NextResponse.json({
    ok: true,
    activateUrl: link.url,
    absolute: link.absolute,
    expiresAt: expiresAt.toISOString(),
    note: link.absolute
      ? "旧链接已作废;新链接 7 天内有效,单次使用"
      : "APP_PUBLIC_URL 未配置,链接为相对路径 —— 外发前请补全域名",
  });
}
