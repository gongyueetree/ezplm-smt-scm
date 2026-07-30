import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { parseReconText } from "@/lib/domain/recon-parse";
import type { ReconSideLine } from "@/lib/domain/recon-match";
import { canAccessKind } from "@/lib/server/recon-access";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { deriveBaseline, runMatch } from "@/lib/server/repositories/reconciliation";

export const runtime = "nodejs";

const Input = z.object({
  /** 对方对账单(粘贴的表格文本) */
  theirsText: z.string().min(1).max(2_000_000),
  baselineSource: z.enum(["DERIVED", "UPLOADED"]),
  /** baselineSource=UPLOADED 时必填:ERP 导出的出货/入库明细 */
  oursText: z.string().max(2_000_000).nullable().optional(),
});

/** 解析结果 → 领域层入参;币种缺失时按对账单币种兜底 */
function toSideLines(
  lines: ReturnType<typeof parseReconText>["lines"],
  fallbackCurrency: string,
): ReconSideLine[] {
  return lines.map((l) => ({
    docNo: l.docNo,
    docLineNo: l.docLineNo,
    mpn: l.mpn,
    qty: l.qty,
    unitPrice: l.unitPrice,
    amount: l.amount,
    currency: l.currency ?? fallbackCurrency,
    dueDate: l.dueDate,
  }));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const st = await prisma.reconciliationStatement.findFirst({
    where: tenantWhere(auth.session.tenantId, { id }),
    select: {
      id: true,
      kind: true,
      currency: true,
      customerId: true,
      supplierId: true,
      periodFrom: true,
      periodTo: true,
    },
  });
  if (!st) return notFound();
  if (!canAccessKind(auth.session.roles, st.kind)) return forbidden("无权操作该类对账单");

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const theirs = parseReconText(parsed.data.theirsText);
  if (theirs.errors.length > 0) {
    return NextResponse.json(
      { error: "对方对账单解析有误", errors: theirs.errors, notices: theirs.notices },
      { status: 422 },
    );
  }

  let ours: ReconSideLine[];
  if (parsed.data.baselineSource === "UPLOADED") {
    if (!parsed.data.oursText?.trim()) {
      return badRequest("选择「上传 ERP 导出明细」时必须提供我方明细");
    }
    const oursParsed = parseReconText(parsed.data.oursText);
    if (oursParsed.errors.length > 0) {
      return NextResponse.json(
        { error: "我方明细解析有误", errors: oursParsed.errors, notices: oursParsed.notices },
        { status: 422 },
      );
    }
    ours = toSideLines(oursParsed.lines, st.currency);
  } else {
    ours = await deriveBaseline(auth.session, {
      kind: st.kind,
      customerId: st.customerId,
      supplierId: st.supplierId,
      periodFrom: st.periodFrom,
      periodTo: st.periodTo,
    });
  }

  const result = await runMatch(
    auth.session,
    id,
    toSideLines(theirs.lines, st.currency),
    ours,
    parsed.data.baselineSource,
  );
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });

  return NextResponse.json({
    summary: result.result.summary,
    notices: theirs.notices,
    baselineCount: ours.length,
  });
}
