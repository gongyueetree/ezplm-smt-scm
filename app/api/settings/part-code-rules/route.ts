import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { previewCodes } from "@/lib/domain/part-code-rule";
import { requirePermission } from "@/lib/server/permissions";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  name: z.string().trim().min(1).max(60),
  prefix: z.string().trim().min(1).max(10),
  includeCategory: z.boolean().optional(),
  separator: z.string().trim().max(2).optional(),
  sequenceWidth: z.number().int().min(1).max(12).optional(),
  allowManual: z.boolean().optional(),
  categoryL1: z.string().trim().nullable().optional(),
  isDefault: z.boolean().optional(),
});

/** 编码规则列表 + 下一个号预览 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const categoryL1 = new URL(req.url).searchParams.get("categoryL1");
  const rules = await prisma.partCodeRule.findMany({
    where: tenantWhere(auth.session.tenantId, { enabled: true }),
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      includeCategory: r.includeCategory,
      separator: r.separator,
      sequenceWidth: r.sequenceWidth,
      currentSequence: r.currentSequence,
      allowManual: r.allowManual,
      categoryL1: r.categoryL1,
      isDefault: r.isDefault,
      // 预览让人看清规则效果,而不是建完才发现号不对
      preview: previewCodes(r, categoryL1 ?? r.categoryL1, 3),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "material.review");
  if (!perm.ok) return perm.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const exists = await prisma.partCodeRule.findFirst({
    where: tenantWhere(auth.session.tenantId, { name: parsed.data.name }),
    select: { id: true },
  });
  if (exists) return badRequest("同名编码规则已存在");

  const rule = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      // 默认规则只能有一条 —— 两条默认会让发号结果不确定
      await tx.partCodeRule.updateMany({
        where: tenantWhere(auth.session.tenantId, { isDefault: true }),
        data: { isDefault: false },
      });
    }
    const created = await tx.partCodeRule.create({
      data: tenantData(auth.session.tenantId, {
        name: parsed.data.name,
        prefix: parsed.data.prefix,
        includeCategory: parsed.data.includeCategory ?? true,
        separator: parsed.data.separator ?? "-",
        sequenceWidth: parsed.data.sequenceWidth ?? 4,
        allowManual: parsed.data.allowManual ?? true,
        categoryL1: parsed.data.categoryL1 ?? null,
        isDefault: parsed.data.isDefault ?? false,
        createdById: auth.session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "PART_CODE_RULE_CREATE",
      entityType: "PartCodeRule",
      entityId: created.id,
      after: { name: created.name, prefix: created.prefix, allowManual: created.allowManual },
    });
    return created;
  });

  return NextResponse.json(
    { id: rule.id, preview: previewCodes(rule, rule.categoryL1, 3) },
    { status: 201 },
  );
}
