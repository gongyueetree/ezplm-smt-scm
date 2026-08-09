import { NextResponse } from "next/server";
import {
  checkRegistration,
  isRegistrationEnabled,
  normalizeEmail,
  REGISTRABLE_ROLES,
  ROLE_LABEL,
  type RegistrableRole,
} from "@/lib/domain/registration";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";

export const runtime = "nodejs";

/** 自助注册加入的租户 —— 演示形态下就是种子建的那一个 */
const DEFAULT_TENANT_SLUG = process.env.SELF_REGISTRATION_TENANT_SLUG ?? "qianchuang";

function disabled() {
  return NextResponse.json(
    { error: "本系统未开放自助注册 —— 请联系管理员开通账号" },
    { status: 403 },
  );
}

/**
 * 注册页需要的选项:是否开放、可选角色、供应商清单。
 *
 * ⚠️ 供应商名称在**未登录**时可见。这是开放注册的必然代价:
 * 供应商账号必须绑定归属,不给选就只能注册出一个处处被拒的空壳账号。
 * 关闭 ALLOW_SELF_REGISTRATION 后这个接口一并关闭,不留半开的口子。
 */
export async function GET() {
  if (!isRegistrationEnabled(process.env)) {
    return NextResponse.json({ enabled: false });
  }
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  return NextResponse.json({
    enabled: true,
    roles: REGISTRABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
    suppliers,
  });
}

export async function POST(req: Request) {
  if (!isRegistrationEnabled(process.env)) return disabled();

  const body = (await req.json().catch(() => null)) as Record<string, string> | null;
  if (!body) return NextResponse.json({ error: "参数不合法" }, { status: 400 });

  const checked = checkRegistration({
    email: body.email ?? "",
    name: body.name ?? "",
    password: body.password ?? "",
    role: body.role ?? "",
    supplierId: body.supplierId ?? null,
  });
  if (!checked.ok) {
    return NextResponse.json({ error: checked.message, field: checked.field }, { status: 400 });
  }
  const { email, name, password, role, supplierId } = checked.value;

  const tenant = await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG } });
  if (!tenant) {
    return NextResponse.json(
      { error: "系统尚未初始化(缺少租户),请联系管理员" },
      { status: 503 },
    );
  }

  /*
   * 已存在的邮箱一律拒绝 —— **绝不 upsert**。
   * 演示账号(pm@demo… 等)必须原样保留,任何人不能靠"注册同名邮箱"
   * 把它们的口令或角色改掉。
   */
  const existing = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "该邮箱已注册 —— 请直接登录,或换一个邮箱", field: "email" },
      { status: 409 },
    );
  }

  if (supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: { tenantId: tenant.id, id: supplierId, isActive: true },
      select: { id: true },
    });
    if (!supplier) {
      return NextResponse.json(
        { error: "所选供应商不存在或已停用", field: "supplierId" },
        { status: 400 },
      );
    }
  }

  const roleRow = await prisma.role.findFirst({
    where: { tenantId: tenant.id, name: role },
    select: { id: true },
  });
  if (!roleRow) {
    return NextResponse.json(
      { error: `角色「${ROLE_LABEL[role as RegistrableRole]}」在本租户未初始化,请联系管理员` },
      { status: 503 },
    );
  }

  const passwordHash = await hashPassword(password);

  let created: { id: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          name,
          passwordHash,
          supplierId,
          isActive: true,
        },
        select: { id: true },
      });
      await tx.userRole.create({
        data: { tenantId: tenant.id, userId: user.id, roleId: roleRow.id },
      });
      await writeAudit(tx, {
        tenantId: tenant.id,
        userId: user.id,
        action: "USER_SELF_REGISTER",
        entityType: "User",
        entityId: user.id,
        // 记谁、什么角色、绑了哪个供应商;**不记口令与哈希**
        after: { email, name, role, supplierId, via: "self-registration" },
      });
      return user;
    });
  } catch (e) {
    /*
     * 并发下两个请求可能同时通过上面的存在性检查,由唯一约束
     * @@unique([tenantId, email]) 兜底 —— 转成和上面一致的 409,
     * 不要把 Prisma 的错误原文吐给未登录用户。
     */
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      return NextResponse.json(
        { error: "该邮箱已注册 —— 请直接登录,或换一个邮箱", field: "email" },
        { status: 409 },
      );
    }
    throw e;
  }

  // 注册即登录 —— 演示场景下再让人回登录页输一遍是白白的摩擦
  const token = await signSession({
    userId: created.id,
    tenantId: tenant.id,
    name,
    roles: [role],
  });
  const res = NextResponse.json({ ok: true, email: normalizeEmail(email) }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
