import { NextResponse } from "next/server";
import { z } from "zod";
import { searchAlternates } from "@/lib/server/repositories/alternate-search";
import { badRequest, requireSession } from "@/lib/server/api";
import { getPartDetail } from "@/lib/server/repositories/part-detail";
import { buildConstraintsFromParams } from "@/lib/server/repositories/alternate-search";

export const runtime = "nodejs";

const ModeSchema = z.enum([
  "PIN_TO_PIN",
  "PACKAGE_COMPATIBLE",
  "FUNCTIONAL",
  "DOMESTIC",
  "LOW_COST",
]);

const BodySchema = z.object({
  mode: ModeSchema.default("FUNCTIONAL"),
  /** 顺序即优先级 */
  constraints: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        required: z.string().nullable(),
        higherIsBetter: z.boolean().optional(),
      }),
    )
    .optional(),
  preferredManufacturers: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

/**
 * GET:取被替代件规格与**默认参数优先级**(供左栏初始化,不跑评分)。
 * POST:按给定模式/优先级/优选厂商跑替代分析。
 *
 * 只读:**不写任何替代关系**。要固化成正式替代关系必须人工维护。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ mpn: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { mpn: raw } = await params;
  const mpn = decodeURIComponent(raw).trim();
  if (!mpn) return badRequest("缺少 MPN");

  const detail = await getPartDetail(auth.session.tenantId, mpn);
  const footprint = (detail.fields.footprint.value as string | null) ?? null;
  return NextResponse.json({
    subject: {
      mpn,
      manufacturer: (detail.fields.manufacturer.value as string | null) ?? null,
      description: (detail.fields.description.value as string | null) ?? null,
      lifecycle: (detail.fields.lifecycle.value as string | null) ?? null,
      footprint,
    },
    constraints: buildConstraintsFromParams(detail.parameters, footprint),
    degraded: detail.degraded,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ mpn: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { mpn: raw } = await params;
  const mpn = decodeURIComponent(raw).trim();
  if (!mpn) return badRequest("缺少 MPN");

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("请求参数不合法");

  const result = await searchAlternates({
    tenantId: auth.session.tenantId,
    mpn,
    mode: parsed.data.mode,
    constraints: parsed.data.constraints,
    preferredManufacturers: parsed.data.preferredManufacturers,
    limit: parsed.data.limit,
  });
  return NextResponse.json(result);
}
