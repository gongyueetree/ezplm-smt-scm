import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import {
  ActivateSchema,
  evaluateInviteAccess,
  hashActionToken,
  tokenAuditRef,
} from "@/lib/domain/portal-invite";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { portalGloballyEnabled, portalEnabledForTenant } from "@/lib/server/portal";
import { clientIp, rateLimitConsume } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const STATUS: Record<string, number> = { not_found: 404, expired: 410, already_used: 409 };

/**
 * R3-3:门户账号激活(公开;鉴权 = 一次性邀请 token)。
 * F3 token 铁律全套:hash 查找、未知/撤销/停用一律 404 防枚举、过期 410、
 * 已用 409、**条件更新**保证单次使用、日志只记 hash 前 8 位。
 * 双开关纪律(F6):env 或租户 flag 任一关闭 → 404。
 */
async function loadInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const invite = await prisma.portalInvite.findUnique({ where: { tokenHash: hashActionToken(token) } });
  if (!invite) return null;
  const account = await prisma.portalAccount.findFirst({
    // 邀请行自带 tenantId,账号查询仍显式 tenant scoped
    where: { id: invite.accountId, tenantId: invite.tenantId },
  });
  if (!account) return null;
  if (!(await portalEnabledForTenant(invite.tenantId))) return null;
  return { invite, account };
}

/** 激活页询问:链接是否可用(可用时返回目标邮箱,供页面展示) */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!portalGloballyEnabled()) return NextResponse.json({ error: "链接无效" }, { status: 404 });
  const ip = clientIp(req);
  if (!(await rateLimitConsume(`portal-activate:${ip ?? "unknown"}`, 30, 60_000))) {
    return NextResponse.json({ error: "请求过于频繁,请稍后再试" }, { status: 429 });
  }
  const { token } = await params;
  const loaded = await loadInvite(token);
  const access = evaluateInviteAccess(
    loaded?.invite ?? null,
    loaded?.account.status === "DISABLED",
  );
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS[access.code] });
  return NextResponse.json({ ok: true, email: loaded!.account.email });
}

/** 客户自设密码 → 账号 ACTIVE。管理员全程不知道密码。 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!portalGloballyEnabled()) return NextResponse.json({ error: "链接无效" }, { status: 404 });
  const ip = clientIp(req);
  // 30/min 与 F3 confirm 一致:鉴权本体是不可猜的一次性 token,限流只是兜底
  if (!(await rateLimitConsume(`portal-activate:${ip ?? "unknown"}`, 30, 60_000))) {
    return NextResponse.json({ error: "请求过于频繁,请稍后再试" }, { status: 429 });
  }
  const { token } = await params;
  const parsed = ActivateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 },
    );
  }

  const loaded = await loadInvite(token);
  const access = evaluateInviteAccess(
    loaded?.invite ?? null,
    loaded?.account.status === "DISABLED",
  );
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS[access.code] });
  const { invite, account } = loaded!;

  const passwordHash = await hashPassword(parsed.data.password);
  const now = new Date();
  const activated = await prisma.$transaction(async (tx) => {
    // 条件更新 = 单次使用的最终防线(并发双击只有一个赢)
    const claimed = await tx.portalInvite.updateMany({
      where: { id: invite.id, status: "PENDING", expiresAt: { gt: now } },
      data: { status: "USED", usedAt: now },
    });
    if (claimed.count === 0) return false;
    await tx.portalAccount.update({
      where: { id: account.id },
      data: { passwordHash, passwordChangedAt: now, status: "ACTIVE", active: true },
    });
    await writeAudit(tx, {
      tenantId: invite.tenantId,
      userId: invite.createdById, // 关联内部责任人 = 邀请人;实际操作者见 actor*
      actorType: "PORTAL_ACCOUNT",
      actorId: account.id,
      actorDisplay: account.email,
      action: "PORTAL_ACCOUNT_ACTIVATE",
      entityType: "PortalAccount",
      entityId: account.id,
      after: { tokenRef: tokenAuditRef(invite.tokenHash), ip },
    });
    return true;
  });
  if (!activated) {
    return NextResponse.json({ error: "该链接已使用,请直接登录门户" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
