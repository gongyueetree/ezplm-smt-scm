import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { ezplmProviderMode, getEzplmPartsProvider } from "@/lib/providers/ezplm";
import { requirePermission } from "@/lib/server/permissions";
import { runDuplicateCheck } from "@/lib/server/repositories/part-create";
import type { DuplicateCandidate } from "@/lib/domain/part-create";

export const runtime = "nodejs";

const Input = z.object({
  internalPn: z.string().trim().min(1).max(80),
  mpn: z.string().trim().max(120).nullable().optional(),
});

/**
 * 建料前的疑似重复检查(本地 + ezPLM)。
 * ezPLM 侧查不到不等于"没有重复" —— 查询失败时如实标注降级,不当作通过。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "material.create");
  if (!perm.ok) return perm.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const local = await runDuplicateCheck(auth.session, {
    internalPn: parsed.data.internalPn,
    mpn: parsed.data.mpn ?? null,
  });

  const candidates: DuplicateCandidate[] = [...local];
  let degraded: string | null = null;

  if (parsed.data.mpn && ezplmProviderMode() === "http") {
    try {
      const found = await getEzplmPartsProvider().searchParts({ keyword: parsed.data.mpn, limit: 5 });
      for (const p of found) {
        if (!p.mpn) continue;
        if (p.mpn.toUpperCase() !== parsed.data.mpn.toUpperCase()) continue;
        candidates.push({
          kind: "SAME_MPN",
          partId: null,
          internalPn: p.internalPn,
          mpn: p.mpn,
          manufacturer: p.manufacturer,
          from: "EZPLM",
          reason: "ezPLM 中已有该 MPN —— 可直接引用其数据,不必手工自建",
          blocking: false,
        });
      }
    } catch (e) {
      degraded = e instanceof Error ? e.message : "ezPLM 查询失败";
    }
  } else if (parsed.data.mpn) {
    degraded = "ezPLM 未配置凭据(当前为示例数据),本次未查外部真源";
  }

  return NextResponse.json({ candidates, degraded });
}
