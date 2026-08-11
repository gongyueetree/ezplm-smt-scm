import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(80),
  defaultAmount: z.string().nullable().optional(),
  currency: z.string().max(8).optional(),
  sortOrder: z.number().int().optional(),
});

/**
 * NRE 项目字典维护(客户 Q6:「NRE 项由客户提供标准清单」)。
 *
 * 客户的标准清单还没给到(C4),所以这里**不预置任何条目** ——
 * 先塞几条我们自己编的「治具费/钢网费」冒充标准,客户照着用几个月之后
 * 再来对不上,那时候改起来是要动历史报价的。空字典时仍允许手填名称,
 * 业务不会被卡住。
 */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const items = await prisma.nreItemDefinition.findMany({
    where: tenantWhere(auth.session.tenantId),
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return NextResponse.json({
    items,
    note:
      items.length === 0
        ? "尚未维护 NRE 项目字典 —— 客户的标准清单待提供(C4)。在此之前 NRE 填报可直接手填名称。"
        : null,
  });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PM" || r === "MANAGEMENT" || r === "ENGINEERING")) {
    return forbidden("仅 PM / 工程 / 管理层可维护 NRE 项目字典");
  }

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const dup = await prisma.nreItemDefinition.findFirst({
    where: tenantWhere(auth.session.tenantId, { code: parsed.data.code.trim() }),
    select: { id: true },
  });
  if (dup) return badRequest(`编码 ${parsed.data.code} 已存在`);

  const item = await prisma.nreItemDefinition.create({
    data: tenantData(auth.session.tenantId, {
      code: parsed.data.code.trim(),
      name: parsed.data.name.trim(),
      // 没给默认金额就留空 —— 填报处显示空白而不是 0,免得直接照着 0 报出去
      defaultAmount: parsed.data.defaultAmount?.trim() || null,
      currency: parsed.data.currency ?? "CNY",
      sortOrder: parsed.data.sortOrder ?? 0,
      createdById: auth.session.userId,
    }),
  });

  await writeAudit(prisma, {
    tenantId: auth.session.tenantId,
    userId: auth.session.userId,
    action: "NRE_ITEM_CREATE",
    entityType: "NreItemDefinition",
    entityId: item.id,
    after: { code: item.code, name: item.name },
  });

  return NextResponse.json({ item }, { status: 201 });
}
