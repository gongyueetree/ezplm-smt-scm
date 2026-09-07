import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/lib/auth/password";
import { PORTAL_COOKIE, PORTAL_TTL_SECONDS, signPortalSession } from "@/lib/auth/portal-session";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { portalGloballyEnabled, portalEnabledForTenant } from "@/lib/server/portal";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const Input = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) });

/** F6-B:门户登录。凭据错误与账号不存在返回同一句话(防枚举);限速 10/min/IP */
export async function POST(req: Request) {
  if (!portalGloballyEnabled()) return NextResponse.json({ error: "客户门户未启用" }, { status: 404 });
  const ip = clientIp(req);
  if (!rateLimit(`portal-login:${ip ?? "unknown"}`, 10, 60_000)) {
    return NextResponse.json({ error: "尝试过于频繁,请稍后再试" }, { status: 429 });
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });

  const account = await prisma.portalAccount.findFirst({
    where: { email: parsed.data.email, active: true },
  });
  const genericFail = NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
  if (!account) return genericFail;
  if (!(await portalEnabledForTenant(account.tenantId))) {
    return NextResponse.json({ error: "客户门户未启用" }, { status: 404 });
  }
  if (!(await verifyPassword(parsed.data.password, account.passwordHash))) return genericFail;

  await prisma.portalAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  await writeAudit(prisma, {
    tenantId: account.tenantId,
    userId: account.invitedById, // 门户账号无内部 userId;实际登录者见 after
    action: "PORTAL_LOGIN",
    entityType: "PortalAccount",
    entityId: account.id,
    after: { email: account.email, ip },
  });

  const token = await signPortalSession({
    portalAccountId: account.id,
    tenantId: account.tenantId,
    customerId: account.customerId,
    email: account.email,
  });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: PORTAL_TTL_SECONDS,
    path: "/",
  });
  return res;
}
