import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { CATEGORY_L1, isCategoryL1 } from "@/lib/domain/part-category";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  categoryL1: z.string().trim().nullable().optional(),
  categoryL2: z.string().trim().max(60).nullable().optional(),
  /** 目标标签集合(整份替换) */
  tagIds: z.array(z.string().min(1)).max(20).optional(),
});

/**
 * 维护单个物料的两级分类与自定义标签。
 *
 * 分类是**人工动作**:系统只在建议时给映射结果,写入必须由人确认
 * (见 lib/domain/part-category.ts:映射不到一律留空,不猜)。
 */
export async function POST(req: Request, { params }: { params: Promise<{ partId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { partId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");
  const { categoryL1, categoryL2, tagIds } = parsed.data;

  if (categoryL1 && !isCategoryL1(categoryL1)) {
    return badRequest(`一级大类必须是封闭集合之一:${CATEGORY_L1.join(" / ")}`);
  }

  const part = await prisma.part.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: partId }),
    select: { id: true, categoryL1: true, categoryL2: true },
  });
  if (!part) return notFound();

  await prisma.$transaction(async (tx) => {
    if (categoryL1 !== undefined || categoryL2 !== undefined) {
      await tx.part.update({
        where: { id: partId },
        data: {
          ...(categoryL1 !== undefined ? { categoryL1: categoryL1 || null } : {}),
          ...(categoryL2 !== undefined ? { categoryL2: categoryL2 || null } : {}),
        },
      });
    }
    if (tagIds) {
      const valid = await tx.partTag.findMany({
        where: tenantWhere(auth.session.tenantId, { id: { in: tagIds } }),
        select: { id: true },
      });
      await tx.partTagLink.deleteMany({ where: tenantWhere(auth.session.tenantId, { partId }) });
      for (const t of valid) {
        await tx.partTagLink.create({
          data: tenantData(auth.session.tenantId, {
            partId,
            tagId: t.id,
            createdById: auth.session.userId,
          }),
        });
      }
    }
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "PART_CLASSIFY",
      entityType: "Part",
      entityId: partId,
      before: { categoryL1: part.categoryL1, categoryL2: part.categoryL2 },
      after: { categoryL1, categoryL2, tagIds },
    });
  });

  return NextResponse.json({ ok: true });
}
