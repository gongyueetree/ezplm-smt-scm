import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().max(30).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

/** 自定义物料分类标签目录(客户要「国产替代物料」「关键 A 类客户物料」这类自定义分组) */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const tags = await prisma.partTag.findMany({
    where: tenantWhere(auth.session.tenantId),
    include: { _count: { select: { links: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color, note: t.note, count: t._count.links })),
  });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  const existing = await prisma.partTag.findFirst({
    where: tenantWhere(auth.session.tenantId, { name: parsed.data.name }),
    select: { id: true },
  });
  if (existing) return badRequest("同名标签已存在");

  const tag = await prisma.$transaction(async (tx) => {
    const created = await tx.partTag.create({
      data: tenantData(auth.session.tenantId, {
        name: parsed.data.name,
        color: parsed.data.color ?? null,
        note: parsed.data.note ?? null,
        createdById: auth.session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "PART_TAG_CREATE",
      entityType: "PartTag",
      entityId: created.id,
      after: { name: created.name },
    });
    return created;
  });
  return NextResponse.json({ id: tag.id, name: tag.name }, { status: 201 });
}
