import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/** MSL 是标准枚举(J-STD-020),不接受自由文本,免得同一等级写出好几种样子 */
const MSL_LEVELS = ["MSL1", "MSL2", "MSL2A", "MSL3", "MSL4", "MSL5", "MSL5A", "MSL6"] as const;

const Input = z.object({
  msl: z.enum(MSL_LEVELS).nullable().optional(),
  packaging: z.string().trim().max(40).nullable().optional(),
  reelQty: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

/**
 * 维护单颗料的 SMT 工艺属性(本地数据,与 ezPLM 只读缓存分离)。
 *
 * 实测真实 ezPLM 接口不提供 MSL/包装/DC —— 所以这些必须能本地维护,
 * 否则客户要的这三列永远是空的。
 */
export async function POST(req: Request, { params }: { params: Promise<{ partId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { partId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(`参数不合法(MSL 需为 ${MSL_LEVELS.join(" / ")} 之一)`);
  }

  const part = await prisma.part.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: partId }),
    select: { id: true },
  });
  if (!part) return notFound();

  const data = {
    msl: parsed.data.msl ?? null,
    packaging: parsed.data.packaging ?? null,
    reelQty: parsed.data.reelQty ?? null,
    note: parsed.data.note ?? null,
    updatedById: auth.session.userId,
  };

  const row = await prisma.$transaction(async (tx) => {
    const before = await tx.partProcessAttr.findFirst({
      where: tenantWhere(auth.session.tenantId, { partId }),
    });
    const saved = await tx.partProcessAttr.upsert({
      where: { partId },
      update: data,
      create: tenantData(auth.session.tenantId, { partId, ...data }),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "PART_PROCESS_ATTR_SET",
      entityType: "PartProcessAttr",
      entityId: saved.id,
      before: before
        ? { msl: before.msl, packaging: before.packaging, reelQty: before.reelQty }
        : null,
      after: { msl: data.msl, packaging: data.packaging, reelQty: data.reelQty },
    });
    return saved;
  });

  return NextResponse.json({ ok: true, id: row.id });
}
