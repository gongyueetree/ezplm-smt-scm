import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { ezplmProviderMode, getEzplmPartsProvider } from "@/lib/providers/ezplm";
import { requirePermission } from "@/lib/server/permissions";

export const runtime = "nodejs";

const Input = z.object({ mpn: z.string().trim().min(1).max(120) });

/**
 * 从 ezPLM 引用物料数据以**预填**建料表单(客户原话:不需要手动在每一个字段输入)。
 *
 * 语义要说清楚:这里只是**把数据抄进表单供人确认**,不是建立缓存行,也不改变数据主权 ——
 * 用户确认后创建出来的仍是 origin=LOCAL 的自建料;
 * 若这颗料本来就在 ezPLM,建议直接引用而不是自建(重复检查会提示)。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "material.create");
  if (!perm.ok) return perm.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  if (ezplmProviderMode() !== "http") {
    return NextResponse.json(
      {
        error: "ezPLM 未配置凭据 —— 当前为示例数据,引用功能待联调",
        code: "not_configured",
      },
      { status: 422 },
    );
  }

  try {
    const found = await getEzplmPartsProvider().searchParts({ keyword: parsed.data.mpn, limit: 5 });
    const hit = found.find((p) => p.mpn?.toUpperCase() === parsed.data.mpn.toUpperCase()) ?? null;
    if (!hit) return notFound("ezPLM 中未找到该 MPN");

    return NextResponse.json({
      // 逐字段标注取自 ezPLM,UI 要显示来源徽标,让人知道哪些不是自己填的
      prefill: {
        mpn: hit.mpn,
        manufacturer: hit.manufacturer,
        description: hit.description,
        footprint: hit.footprint,
        lifecycle: hit.lifecycle,
        rohs: hit.rohs,
        reach: hit.reach,
        msl: hit.msl,
        packaging: hit.packaging,
        category: hit.category,
      },
      source: "EZPLM",
      dataUpdatedAt: hit.updatedAt,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ezPLM 查询失败", code: "degraded" },
      { status: 502 },
    );
  }
}
