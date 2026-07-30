import { NextResponse } from "next/server";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { createQuote } from "@/lib/server/repositories/quote";
import { generateQuoteLinesFromBom } from "@/lib/server/repositories/quote-from-bom";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * BOM → 报价一键转化(客户 xlsx 原话:「有,但是没有嵌入 BOM 模块转化的按钮」)。
 *
 * 转化链路本来就有(POST /api/quotes/[versionId]/from-bom),缺的只是入口。
 * 这里补上入口并把 rfqId / customerId 从 BOM 自动带入 —— BOM 上本就有这两个字段,
 * 不该再让人手填一遍。
 *
 * 纪律不变:只取**已人工确认**的匹配行;分类仍需逐行人工确认;不臆造成本。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PM" || r === "MANAGEMENT")) {
    return forbidden("仅 PM 或管理层可生成报价");
  }
  const { versionId } = await params;

  const version = await prisma.bOMVersion.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: versionId }),
    include: { bom: { select: { id: true, name: true, rfqId: true, customerId: true } } },
  });
  if (!version) return notFound();
  if (!version.bom.rfqId || !version.bom.customerId) {
    return badRequest(
      "该 BOM 未关联 RFQ 或客户,无法生成报价 —— 请先在 RFQ 下挂载该 BOM(报价必须归属客户与 RFQ)",
    );
  }

  const quote = await createQuote(auth.session, {
    rfqId: version.bom.rfqId,
    customerId: version.bom.customerId,
  });

  // 与报价页那条入口共用同一份行生成逻辑(不走内部 HTTP)
  const result = await generateQuoteLinesFromBom(auth.session, quote.version.id, versionId);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, quoteVersionId: quote.version.id }, { status: 422 });
  }

  return NextResponse.json(
    {
      quoteVersionId: quote.version.id,
      quoteCode: quote.quote.code,
      lines: result.count,
      missingCost: result.missingCost,
      note: result.note,
    },
    { status: 201 },
  );
}
