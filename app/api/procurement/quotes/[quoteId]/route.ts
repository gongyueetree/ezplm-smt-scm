import { NextResponse } from "next/server";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * N-5.D(客户 PR2 反馈 采购-4D:「保存所有线下供应商包括 DigiKey Mouser 的报价,
 * 但是给予删除的权限」)。
 *
 * 删除的是**一整批**报价(一次上传 = 一个 SupplierQuote),不是单行 ——
 * 客户要删的场景是"这份报价文件传错了/作废了",按行删只会留下半份。
 *
 * 纪律:
 * - 必须写原因。报价是比价与下单的依据,删掉一批价而不说为什么,
 *   事后没人能解释当时为什么换了供应商;
 * - 删除前把**被删内容的摘要**写进审计(供应商、批次时间、行数、料号),
 *   删完再记就只剩一个 id,谁也复原不出删了什么;
 * - 已经被采纳进选型结论的报价**不允许删** —— 那会让已下的决策失去依据。
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可删除报价");
  }
  const { quoteId } = await params;

  const body = (await req.json().catch(() => null)) as { reason?: string } | null;
  const reason = body?.reason?.trim();
  if (!reason) {
    return badRequest("删除报价必须填写原因 —— 它是比价与下单的依据,删了要能解释");
  }

  const quote = await prisma.supplierQuote.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: quoteId }),
    include: { lines: true },
  });
  if (!quote) return notFound("报价批次不存在或不属于当前租户");

  // 已被采纳的报价不能删 —— 删了会让已下的选型决策失去依据
  const selected = quote.lines.filter((l) => l.resolution !== null).length;
  if (selected > 0) {
    return NextResponse.json(
      {
        error: `该批报价中有 ${selected} 行已有处理结论(已参与选型决策),不允许删除 —— 如确需作废请先撤销这些结论`,
      },
      { status: 422 },
    );
  }

  const supplier = await prisma.supplier.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: quote.supplierId }),
    select: { name: true },
  });

  await prisma.$transaction(async (tx) => {
    // 先记审计:删完再记就只剩一个 id,复原不出删了什么
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "SUPPLIER_QUOTE_DELETE",
      entityType: "SupplierQuote",
      entityId: quote.id,
      before: {
        supplier: supplier?.name ?? quote.supplierId,
        provider: quote.provider,
        currency: quote.currency,
        quotedAt: quote.quotedAt.toISOString(),
        lineCount: quote.lines.length,
        mpns: quote.lines.slice(0, 50).map((l) => l.mpn),
      },
      after: { reason },
    });
    await tx.supplierQuoteLine.deleteMany({
      where: tenantWhere(auth.session.tenantId, { supplierQuoteId: quote.id }),
    });
    await tx.supplierQuote.deleteMany({
      where: tenantWhere(auth.session.tenantId, { id: quote.id }),
    });
  });

  return NextResponse.json({ ok: true, deletedLines: quote.lines.length });
}
