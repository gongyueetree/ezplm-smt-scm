import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { hashPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  customerId: z.string().min(1),
  email: z.string().trim().email().max(160),
  /** 初始口令由管理员设定并线下交付;门户无自注册/找回,重置也走管理员 */
  password: z.string().min(8).max(100),
});

/** F6-B:门户账号邀请(仅内部 MANAGEMENT;无自注册路径) */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.includes("MANAGEMENT")) return forbidden("仅管理层可邀请门户账号");

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法(口令至少 8 位)");

  const customer = await prisma.customer.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: parsed.data.customerId }),
    select: { id: true, name: true },
  });
  if (!customer) return badRequest("客户不存在或不属于当前租户");

  const existing = await prisma.portalAccount.findFirst({
    where: tenantWhere(auth.session.tenantId, { email: parsed.data.email }),
  });
  if (existing) return badRequest("该邮箱已有门户账号");

  const account = await prisma.portalAccount.create({
    data: tenantData(auth.session.tenantId, {
      customerId: customer.id,
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      invitedById: auth.session.userId,
    }),
  });
  await writeAudit(prisma, {
    tenantId: auth.session.tenantId,
    userId: auth.session.userId,
    action: "PORTAL_ACCOUNT_INVITE",
    entityType: "PortalAccount",
    entityId: account.id,
    after: { email: account.email, customer: customer.name },
  });
  return NextResponse.json({ ok: true, accountId: account.id }, { status: 201 });
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.includes("MANAGEMENT")) return forbidden("仅管理层可查看门户账号");
  const accounts = await prisma.portalAccount.findMany({
    where: tenantWhere(auth.session.tenantId),
    select: { id: true, email: true, customerId: true, active: true, lastLoginAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ accounts });
}
