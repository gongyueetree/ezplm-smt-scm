import { NextResponse } from "next/server";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { commitQuoteUpload, previewQuoteUpload } from "@/lib/server/repositories/rfq-supplier";

export const runtime = "nodejs";

/**
 * R4-7(§42/§43):供应商报价 Excel 回传。
 * 默认 preview(解析 + 厂商解析 + 冲突标记);?confirm=1 落库
 * (SupplierOffer status=RECEIVED + 全部 PriceBreak,绝不只留最低价)。
 */
export async function POST(req: Request, { params }: { params: Promise<{ prfqId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("报价回传属采购/管理层");
  }
  const { prfqId } = await params;
  const url = new URL(req.url);
  const supplierId = url.searchParams.get("supplierId");
  if (!supplierId) return badRequest("需要 supplierId");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("缺少文件");
  const buf = Buffer.from(await file.arrayBuffer());

  const preview = await previewQuoteUpload(auth.session, prfqId, supplierId, buf);
  if (url.searchParams.get("confirm") !== "1") {
    return NextResponse.json({
      preview: {
        groups: preview.groups.map((g) => ({
          internalPn: g.internalPn,
          quotedMpn: g.quotedMpn,
          quotedManufacturer: g.quotedManufacturer,
          canonicalManufacturerName: g.canonicalManufacturerName,
          manufacturerResolution: g.manufacturerResolution,
          flags: g.flags,
          currency: g.currency,
          breaks: g.breaks.length,
        })),
        issues: preview.issues,
        skippedRows: preview.skippedRows,
        admissible: preview.admissible,
      },
    });
  }
  const r = await commitQuoteUpload(auth.session, prfqId, supplierId, preview);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json({ ok: true, offers: r.offers, breaks: r.breaks });
}
