import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { createPart } from "@/lib/server/repositories/part-create";

export const runtime = "nodejs";

const FormSchema = z.object({
  internalPn: z.string().trim().max(80).nullable().optional(),
  mpn: z.string().trim().max(120).nullable().optional(),
  manufacturer: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  descriptionEn: z.string().trim().max(300).nullable().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  categoryL1: z.string().trim().max(40).nullable().optional(),
  categoryL2: z.string().trim().max(60).nullable().optional(),
  footprint: z.string().trim().max(80).nullable().optional(),
  lifecycle: z.enum(["ACTIVE", "NRND", "EOL", "OBSOLETE", "UNKNOWN"]).nullable().optional(),
  rohs: z.boolean().nullable().optional(),
  reach: z.boolean().nullable().optional(),
  msl: z.string().trim().max(20).nullable().optional(),
  packaging: z.string().trim().max(40).nullable().optional(),
  reelQty: z.number().int().nonnegative().nullable().optional(),
  moq: z.number().int().nonnegative().nullable().optional(),
  spq: z.number().int().nonnegative().nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  safetyStock: z.string().trim().max(30).nullable().optional(),
  attributes: z
    .record(
      z.string(),
      z.object({
        value: z.string().max(200),
        source: z.string().max(20).optional(),
        confidence: z.number().min(0).max(1).nullable().optional(),
      }),
    )
    .optional(),
  supplierId: z.string().trim().nullable().optional(),
  supplierPn: z.string().trim().max(120).nullable().optional(),
  referencePrice: z.string().trim().max(30).nullable().optional(),
  currency: z.string().trim().length(3).nullable().optional(),
  createdVia: z.enum(["MANUAL", "EZPLM_REFERENCE", "IMPORT", "ERP_SYNC"]).optional(),
  duplicateResolution: z.enum(["USE_EXISTING", "MAP_CUSTOMER_PN", "CREATE_ANYWAY"]).nullable().optional(),
  duplicateReason: z.string().trim().max(500).nullable().optional(),
  aiEvidence: z.unknown().optional(),
  /** DRAFT = 保存草稿;PENDING_REVIEW/ACTIVE = 正式创建 */
  target: z.enum(["DRAFT", "PENDING_REVIEW", "ACTIVE"]).default("ACTIVE"),
});

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "material.create");
  if (!perm.ok) return perm.response;

  const parsed = FormSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法", { issues: parsed.error.issues });

  const { target, ...input } = parsed.data;
  const r = await createPart(auth.session, input, target);
  if (!r.ok) {
    return NextResponse.json(
      { error: r.message, code: r.code, issues: r.issues, candidates: r.candidates },
      { status: r.code === "validation" ? 400 : 409 },
    );
  }
  return NextResponse.json({ partId: r.partId, status: r.status }, { status: 201 });
}
