import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { decideMfgMapping, listMfgMappings } from "@/lib/server/repositories/part-mfg-mapping";

export const runtime = "nodejs";

/** R4-2:某内部料的 MFG 关系列表(真源;Part.mpn 只是 preferred 缓存) */
export async function GET(_req: Request, { params }: { params: Promise<{ partId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { partId } = await params;
  const mappings = await listMfgMappings(auth.session, partId);
  return NextResponse.json({
    mappings: mappings.map((m) => ({
      id: m.id,
      rawManufacturer: m.rawManufacturer,
      manufacturerPartNo: m.manufacturerPartNo,
      canonicalManufacturerName: m.canonicalManufacturerName,
      materialKind: m.materialKind,
      identifierKind: m.identifierKind,
      identifierMatchMode: m.identifierMatchMode,
      relationType: m.relationType,
      status: m.status,
      source: m.source,
      sourceDocumentNo: m.sourceDocumentNo,
      evidenceCount: m.evidenceCount,
      firstSeenAt: m.firstSeenAt,
      lastSeenAt: m.lastSeenAt,
      manufacturerResolutionStatus: m.manufacturerResolutionStatus,
      confirmedAt: m.confirmedAt,
    })),
  });
}

const DecideInput = z.object({
  mappingId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  relationType: z.enum(["PRIMARY", "APPROVED", "ALTERNATE", "HISTORICAL", "MAINTAINED"]).optional(),
  syncPreferred: z.boolean().optional(),
});

/**
 * R4-2:人工审批映射(工程/管理层)。
 * syncPreferred 经 §23 守卫:仅 APPROVED+PRIMARY+人工确认 且非 PATTERN 才写 Part.mpn。
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ partId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "ENGINEERING" || r === "MANAGEMENT")) {
    return forbidden("MFG 关系审批属工程/管理层");
  }
  await params;
  const parsed = DecideInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");
  const r = await decideMfgMapping(auth.session, parsed.data.mappingId, parsed.data);
  if (!r.ok) return badRequest(r.reason);
  return NextResponse.json({ ok: true });
}
