import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { isFrozen, type QuoteStatusValue } from "@/lib/domain/quote-status";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日期需为 YYYY-MM-DD")
    .nullable(),
});

/**
 * 设置报价有效期(正式报价单必备项)。
 * 冻结态拒绝修改 —— 有效期随快照冻结,已提交/已批准的单据不允许改。
 */
export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { versionId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "参数不合法");

  const version = await prisma.quoteVersion.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: versionId }),
    select: { id: true, status: true, validUntil: true },
  });
  if (!version) return notFound();
  if (isFrozen(version.status as QuoteStatusValue)) {
    return NextResponse.json(
      { error: "该版本已提交/已批准,有效期已随快照冻结,不可修改" },
      { status: 422 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.quoteVersion.update({
      where: { id: versionId },
      data: { validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null },
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "QUOTE_VALID_UNTIL_SET",
      entityType: "QuoteVersion",
      entityId: versionId,
      before: { validUntil: version.validUntil?.toISOString().slice(0, 10) ?? null },
      after: { validUntil: parsed.data.validUntil },
    });
  });

  return NextResponse.json({ ok: true });
}
