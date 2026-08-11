import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { checkConvertToProduction, matchInternalPns } from "@/lib/domain/bom-purpose";
import { buildMatchContext, executeConvert, loadSourceBom, SCAN_CAP } from "@/lib/server/repositories/bom-convert";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  customerId: z.string().nullable().optional(),
  acknowledgeUnmatched: z.boolean().optional(),
  previewOnly: z.boolean().optional(),
});

/**
 * PR2-PM-03 / PR2-ENG-02:预 BOM 一键转正式 BOM(客户 Q4 答复 A)。
 *
 * `previewOnly` 先算不落库 —— 客户要先看清"哪几行匹配不上",
 * 再决定是补料还是带着标记转。**预览与执行走同一套匹配代码**,
 * 否则预览说 3 行待补、转完变 5 行,谁也不敢再信预览。
 */
export async function POST(req: Request, { params }: { params: Promise<{ bomId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { bomId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const source = await loadSourceBom(auth.session.tenantId, bomId);
  if (!source) return notFound("BOM 不存在或不属于当前租户");

  const customerId = parsed.data.customerId ?? source.customerId;

  // 预览对所有角色开放(看清差距不需要权限);**落库**限 PM / 工程 / 管理层
  if (!parsed.data.previewOnly) {
    const allowed = auth.session.roles.some(
      (r) => r === "PM" || r === "ENGINEERING" || r === "MANAGEMENT",
    );
    if (!allowed) return forbidden("转正式 BOM 由 PM 或工程发起", "bom_convert_role");
  }

  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: tenantWhere(auth.session.tenantId, { id: customerId }),
      select: { id: true },
    });
    if (!customer) return badRequest("指定的客户不存在或不属于当前租户");
  }

  const rawMpns = source.lines.map((l) => l.mpn).filter((m): m is string => !!m);
  const { ctx, scanTruncated, mappingTruncated } = customerId
    ? await buildMatchContext(auth.session.tenantId, customerId, rawMpns)
    : {
        ctx: { byCustomerPn: new Map(), byMpn: new Map() },
        scanTruncated: false,
        mappingTruncated: false,
      };

  const summary = matchInternalPns(source.lines, ctx);

  const guard = checkConvertToProduction({
    sourcePurpose: source.purpose,
    customerId,
    lineCount: source.lines.length,
    needsManual: summary.needsManual,
    acknowledgeUnmatched: parsed.data.acknowledgeUnmatched ?? false,
  });

  const truncationNote = scanTruncated || mappingTruncated
    ? `物料主数据超过 ${SCAN_CAP} 条,归一化匹配(忽略大小写与连字符)只覆盖了前 ${SCAN_CAP} 条 —— 完全同名的仍然准确匹配,但形如 ABC-123 / abc123 的差异可能漏掉。少匹配的行会显示为「待补」,不代表系统里真的没有这颗料。`
    : null;

  const preview = {
    sourceBom: { id: source.id, name: source.name, purpose: source.purpose },
    customerId,
    lineCount: source.lines.length,
    matched: summary.matched,
    ambiguous: summary.ambiguous,
    unmatched: summary.unmatched,
    needsManual: summary.needsManual,
    truncationNote,
    // 只回前 200 行明细,页面要全量看走 BOM 详情页
    lines: summary.results.slice(0, 200).map((r) => ({
      lineNo: r.lineNo,
      internalPn: r.internalPn,
      source: r.source,
      ambiguous: r.ambiguous,
      reason: r.reason,
    })),
  };

  if (parsed.data.previewOnly) {
    return NextResponse.json({ preview, guard });
  }

  if (!guard.ok) {
    return NextResponse.json({ error: guard.message, code: guard.code, preview, guard }, { status: 422 });
  }

  const { bom, version } = await executeConvert({
    tenantId: auth.session.tenantId,
    userId: auth.session.userId,
    source,
    customerId: customerId!,
    summary,
    scanTruncated,
  });

  return NextResponse.json(
    {
      bomId: bom.id,
      versionId: version.id,
      preview,
      note:
        summary.needsManual > 0
          ? `已生成正式 BOM,其中 ${summary.needsManual} 行标记为「待补内部料号」—— 量产前必须补齐。原预 BOM 未被修改。`
          : "已生成正式 BOM,全部行均匹配到内部料号。原预 BOM 未被修改。",
    },
    { status: 201 },
  );
}
