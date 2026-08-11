import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { checkOutcomeChange, type QuoteOutcomeValue } from "@/lib/domain/quote-outcome";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  outcome: z.enum(["OPEN", "WON", "LOST", "EXPIRED"]),
  customerOrderNo: z.string().max(64).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/**
 * PR2-PM-06 / 客户 Q7:**人工在报价单上标记「已中标」**。
 *
 * 系统不从任何地方推断中标 —— 没有 ERP 订单对接,
 * 任何"自动判定"都是编的。标记写在 Quote 上(整张报价单),
 * 不是某个 Revision:客户下单针对的是这笔生意,不是我们内部第几版。
 */
export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PM" || r === "MANAGEMENT")) {
    return forbidden("订单结果由 PM 或管理层标记", "quote_outcome_role");
  }
  const { versionId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const version = await prisma.quoteVersion.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: versionId }),
    select: { quoteId: true },
  });
  if (!version) return notFound("报价版本不存在或不属于当前租户");

  const quote = await prisma.quote.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: version.quoteId }),
    select: { id: true, code: true, outcome: true },
  });
  if (!quote) return notFound("报价单不存在或不属于当前租户");

  const approvedCount = await prisma.quoteVersion.count({
    where: tenantWhere(auth.session.tenantId, { quoteId: quote.id, status: "APPROVED" as const }),
  });

  const check = checkOutcomeChange({
    from: quote.outcome as QuoteOutcomeValue,
    to: parsed.data.outcome,
    note: parsed.data.note ?? null,
    hasApprovedVersion: approvedCount > 0,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.message, code: check.code }, { status: 422 });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.quote.updateMany({
      where: tenantWhere(auth.session.tenantId, { id: quote.id }),
      data: {
        outcome: parsed.data.outcome,
        outcomeAt: parsed.data.outcome === "OPEN" ? null : now,
        outcomeById: auth.session.userId,
        customerOrderNo: parsed.data.customerOrderNo?.trim() || null,
        outcomeNote: parsed.data.note?.trim() || null,
      },
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "QUOTE_OUTCOME_MARK",
      entityType: "Quote",
      entityId: quote.id,
      before: { outcome: quote.outcome },
      after: {
        outcome: parsed.data.outcome,
        customerOrderNo: parsed.data.customerOrderNo ?? null,
        note: parsed.data.note ?? null,
      },
    });
  });

  return NextResponse.json({
    ok: true,
    outcome: parsed.data.outcome,
    note:
      parsed.data.outcome === "WON"
        ? "已标记为「已中标」—— 这是人工标记的结果,系统不会自动核对客户订单"
        : "已更新订单结果",
  });
}
