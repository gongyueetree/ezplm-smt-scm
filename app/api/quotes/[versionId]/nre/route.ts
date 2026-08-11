import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { checkNreItems, sumNre } from "@/lib/domain/quote-tasks";
import { fileNreLines } from "@/lib/server/repositories/quote-nre";
import { summarizeVersion } from "@/lib/server/repositories/quote";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  taskId: z.string().nullable().optional(),
  items: z.array(
    z.object({
      definitionId: z.string().nullable().optional(),
      name: z.string(),
      amount: z.string(),
      note: z.string().max(300).nullable().optional(),
    }),
  ),
});

/**
 * PR2-PM-06 / 客户 Q6:NRE 填报 —— **工程填完直接回报价,不需审批**。
 *
 * 客户还点了两件事:NRE 项「设为可选」「要有备注项」。
 * 所以:字典项只是候选,允许手填名称;每一项都能写备注,备注跟着落到报价行上。
 */
export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "ENGINEERING" || r === "PM" || r === "MANAGEMENT")) {
    return forbidden("NRE 由工程填报(PM 亦可代填)", "quote_nre_role");
  }
  const { versionId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const checked = checkNreItems(
    parsed.data.items.map((i) => ({
      definitionId: i.definitionId ?? null,
      name: i.name,
      amount: i.amount,
      note: i.note ?? null,
    })),
  );
  if (!checked.ok) {
    return NextResponse.json({ error: checked.message, code: checked.code }, { status: 422 });
  }

  // 引用的字典项必须真实存在于本租户 —— 前端传什么都认会让审计里的 definitionId 变成噪音
  const defIds = [...new Set(checked.items.map((i) => i.definitionId).filter((d): d is string => !!d))];
  if (defIds.length > 0) {
    const found = await prisma.nreItemDefinition.count({
      where: tenantWhere(auth.session.tenantId, { id: { in: defIds } }),
    });
    if (found !== defIds.length) return badRequest("引用了不存在的 NRE 项目字典项");
  }

  const result = await fileNreLines(
    auth.session,
    versionId,
    checked.items,
    parsed.data.taskId ?? null,
  );
  if (!result.ok) {
    if (result.code === "not_found") return notFound(result.message);
    return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
  }

  return NextResponse.json(
    {
      created: result.created,
      nreTotal: sumNre(checked.items),
      summary: await summarizeVersion(auth.session, versionId),
      note: "NRE 已直接写入报价行(无需单独审批)—— 报价总额随之更新",
    },
    { status: 201 },
  );
}
