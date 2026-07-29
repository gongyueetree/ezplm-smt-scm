import { NextResponse } from "next/server";
import { badRequest, requireSession } from "@/lib/server/api";
import { getPartDetail } from "@/lib/server/repositories/part-detail";

export const runtime = "nodejs";

/**
 * 替代料分析(对任意型号可用)。
 *
 * 复用物料详情的聚合逻辑:被替代件的封装/生命周期来自多源合并结果,
 * 候选来自 本系统物料库 → ezPLM → DigiKey,排序见 lib/domain/alternate-rank.ts。
 *
 * 只读接口:**不写任何替代关系**。要固化成正式替代关系必须人工维护。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ mpn: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { mpn: raw } = await params;
  const mpn = decodeURIComponent(raw).trim();
  if (!mpn) return badRequest("缺少 MPN");

  const detail = await getPartDetail(auth.session.tenantId, mpn);
  return NextResponse.json({
    mpn,
    subject: {
      footprint: (detail.fields.footprint.value as string | null) ?? null,
      lifecycle: (detail.fields.lifecycle.value as string | null) ?? null,
    },
    alternates: detail.alternates,
    degraded: detail.degraded,
  });
}
