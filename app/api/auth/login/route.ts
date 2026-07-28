import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { RoleName } from "@/lib/routes";

export const runtime = "nodejs";

const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const parsed = LoginInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请输入合法的邮箱与密码" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  // 一期单租户开发形态:按邮箱全局定位用户(邮箱在租户内唯一;多租户登录入口随部署形态细化)
  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    include: { userRoles: { include: { role: true } } },
  });
  // 统一错误文案,不区分"用户不存在/密码错误"(防枚举)
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
  }

  const roles = user.userRoles.map((ur) => ur.role.name) as RoleName[];
  const token = await signSession({
    userId: user.id,
    tenantId: user.tenantId,
    name: user.name,
    roles,
  });

  await writeAudit(prisma, {
    tenantId: user.tenantId,
    userId: user.id,
    action: "AUTH_LOGIN",
    entityType: "User",
    entityId: user.id,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
