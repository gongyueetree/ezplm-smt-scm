import { NextResponse } from "next/server";
import { familyPrefix, filterCandidates } from "@/lib/domain/alternate-candidates";
import { ProviderError } from "@/lib/providers/common/errors";
import { ezplmProviderMode, getEzplmPartsProvider } from "@/lib/providers/ezplm";
import { badRequest, requireSession } from "@/lib/server/api";

export const runtime = "nodejs";

/**
 * 同系列**候选**替代料检索(客户需求:每一个物料都能查替代料)。
 *
 * 为什么单独做成按钮触发的接口而不是随详情页一起加载:
 * - ezPLM 查询接口有**日调用配额**,详情页每次打开都多打一次检索会白烧配额;
 * - 这里返回的是**候选**,不是已成立的替代关系 —— 需要人主动发起、人工判定。
 *
 * 本接口**只读**,不写任何替代关系;要固化替代关系必须走人工维护。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ mpn: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { mpn: raw } = await params;
  const mpn = decodeURIComponent(raw).trim();
  if (!mpn) return badRequest("缺少 MPN");

  const keyword = familyPrefix(mpn);
  if (!keyword) {
    return NextResponse.json({
      keyword: null,
      candidates: [],
      mode: ezplmProviderMode(),
      note: "该型号过短,无法推导出可靠的系列前缀,已放弃检索(宁可不查也不返回噪音结果)。",
    });
  }

  try {
    const rows = await getEzplmPartsProvider().searchParts({ keyword, limit: 30 });
    const candidates = filterCandidates(
      mpn,
      rows.map((r) => ({
        mpn: r.mpn ?? "",
        manufacturer: r.manufacturer,
        description: r.description,
        footprint: r.footprint,
      })).filter((r) => r.mpn),
    );
    return NextResponse.json({
      keyword,
      candidates,
      mode: ezplmProviderMode(),
      note: null,
    });
  } catch (e) {
    const err =
      e instanceof ProviderError
        ? { provider: e.provider, kind: e.kind, message: e.message }
        : { provider: "EZPLM", kind: "unknown", message: e instanceof Error ? e.message : String(e) };
    return NextResponse.json(
      { keyword, candidates: [], mode: ezplmProviderMode(), degraded: err },
      { status: 200 },
    );
  }
}
