import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const Input = z.object({
  name: z.string().trim().min(1).max(40),
  tier: z.enum(["A", "B", "C"]).nullable().optional(),
  /** 小数形式,如 0.15 = 15%;留空表示未维护 */
  defaultMarkupPct: z.string().regex(/^\d*\.?\d+$/).nullable().optional(),
  laborTemplateId: z.string().trim().max(40).nullable().optional(),
  confirmedByBusiness: z.boolean().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "MANAGEMENT" || r === "PM")) {
    return forbidden("仅 PM 或管理层可维护报价模板");
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法(Markup 需为小数,如 0.15 表示 15%)");

  const dup = await prisma.quoteTemplate.findFirst({
    where: tenantWhere(auth.session.tenantId, { name: parsed.data.name }),
    select: { id: true },
  });
  if (dup) return badRequest("同名模板已存在");

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.quoteTemplate.create({
      data: tenantData(auth.session.tenantId, {
        name: parsed.data.name,
        tier: parsed.data.tier ?? null,
        defaultMarkupPct: parsed.data.defaultMarkupPct
          ? new Prisma.Decimal(parsed.data.defaultMarkupPct)
          : null,
        laborTemplateId: parsed.data.laborTemplateId ?? null,
        confirmedByBusiness: parsed.data.confirmedByBusiness ?? false,
        note: parsed.data.note ?? null,
        createdById: auth.session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "QUOTE_TEMPLATE_CREATE",
      entityType: "QuoteTemplate",
      entityId: created.id,
      after: {
        name: created.name,
        tier: created.tier,
        markup: created.defaultMarkupPct?.toString() ?? null,
      },
    });
    return created;
  });

  return NextResponse.json({ id: row.id, name: row.name }, { status: 201 });
}
