import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import {
  approveManufacturerAlias,
  buildManufacturerReview,
  rejectManufacturerSuggestion,
} from "@/lib/server/repositories/manufacturer-review";
import { prisma } from "@/lib/server/db";

export const runtime = "nodejs";

function canReview(roles: readonly string[]): boolean {
  return roles.some((r) => r === "ENGINEERING" || r === "MANAGEMENT");
}

/** R4-3(§19):Manufacturer Resolution Review 清单 + 标准制造商下拉 */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!canReview(auth.session.roles)) return forbidden("制造商解析评审属工程/管理层");
  const [rows, canonicals] = await Promise.all([
    buildManufacturerReview(auth.session),
    prisma.canonicalManufacturerRef.findMany({
      select: { id: true, canonicalName: true, nameZh: true },
      orderBy: { canonicalName: "asc" },
    }),
  ]);
  return NextResponse.json({
    rows: rows.map((r) => ({
      rawManufacturer: r.rawManufacturer,
      mappingCount: r.mappingCount,
      suggestion: {
        canonicalManufacturerId: r.suggestion.canonicalManufacturerId,
        canonicalManufacturerName: r.suggestion.canonicalManufacturerName,
        resolution: r.suggestion.resolution,
        confidence: r.suggestion.confidence,
        evidence: r.suggestion.evidence,
        requiresManualDecision: r.suggestion.requiresManualDecision,
      },
    })),
    canonicals,
  });
}

const PostInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    rawName: z.string().min(1).max(200),
    canonicalRefId: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  }),
  z.object({ action: z.literal("reject"), rawName: z.string().min(1).max(200) }),
  z.object({
    action: z.literal("bulk-approve"),
    /** 只批「确定性来源」建议(TENANT/GLOBAL/CANONICAL);阈值下限防误伤 */
    minConfidence: z.number().min(0.9).max(1).default(0.98),
  }),
]);

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!canReview(auth.session.roles)) return forbidden("制造商解析评审属工程/管理层");
  const parsed = PostInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");
  const input = parsed.data;

  if (input.action === "approve") {
    const r = await approveManufacturerAlias(auth.session, input);
    if (!r.ok) return badRequest(r.reason);
    return NextResponse.json({ ok: true, updatedMappings: r.updatedMappings });
  }
  if (input.action === "reject") {
    await rejectManufacturerSuggestion(auth.session, input);
    return NextResponse.json({ ok: true });
  }

  // bulk-approve:仅确定性解析(别名/标准名精确)可批量;
  // MPN_EVIDENCE/FUZZY 永远逐条人工(§20)
  const rows = await buildManufacturerReview(auth.session);
  let approved = 0;
  for (const row of rows) {
    const s = row.suggestion;
    const deterministic =
      s.resolution === "TENANT_ALIAS" || s.resolution === "GLOBAL_ALIAS" || s.resolution === "CANONICAL_EXACT";
    if (!deterministic || !s.canonicalManufacturerId || s.confidence < input.minConfidence) continue;
    const r = await approveManufacturerAlias(auth.session, {
      rawName: row.rawManufacturer,
      canonicalRefId: s.canonicalManufacturerId,
      confidence: s.confidence,
    });
    if (r.ok) approved++;
  }
  return NextResponse.json({ ok: true, approved });
}
