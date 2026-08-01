import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { applyTransform, validateMapping } from "@/lib/domain/erp-sync";
import { prisma } from "@/lib/server/db";
import { requirePermission } from "@/lib/server/permissions";
import { getMetadata } from "@/lib/server/repositories/erp-connection";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import { writeAudit } from "@/lib/server/audit";

export const runtime = "nodejs";

const ENTITIES = ["MATERIAL", "INVENTORY", "OPEN_PO", "WORK_ORDER", "PURCHASE_ORDER", "ETA_WRITEBACK", "RECEIPT_LOT", "SHIPMENT"] as const;

const Input = z.object({
  entityType: z.enum(ENTITIES),
  mappings: z
    .array(
      z.object({
        erpField: z.string().trim().max(80),
        localField: z.string().trim().min(1).max(60),
        transform: z.string().trim().max(40).nullable().optional(),
        defaultValue: z.string().trim().max(120).nullable().optional(),
        required: z.boolean().optional(),
        /** 样例值:保存时做一次转换验证 */
        sampleValue: z.string().max(200).nullable().optional(),
      }),
    )
    .max(200),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.connection.view");
  if (!perm.ok) return perm.response;

  const { id } = await params;
  const entityType = new URL(req.url).searchParams.get("entityType") ?? "MATERIAL";
  const [rows, metadata] = await Promise.all([
    prisma.erpFieldMapping.findMany({
      where: tenantWhere(auth.session.tenantId, { connectionId: id, entityType: entityType as (typeof ENTITIES)[number] }),
      orderBy: { sortOrder: "asc" },
    }),
    getMetadata(auth.session, id),
  ]);
  if (!metadata) return notFound();

  return NextResponse.json({
    mappings: rows.map((m) => ({
      erpField: m.erpField,
      localField: m.localField,
      transform: m.transform,
      defaultValue: m.defaultValue,
      required: m.required,
      sampleResult: m.sampleResult,
    })),
    erpFields: metadata.entityFields[entityType] ?? [],
    notImplemented: metadata.notImplemented,
  });
}

/** 保存映射:**必须通过样例验证与必填校验** */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.mapping.manage");
  if (!perm.ok) return perm.response;

  const { id } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");
  const { entityType, mappings } = parsed.data;

  const issues = validateMapping(entityType, mappings);
  if (issues.length > 0) {
    return NextResponse.json(
      { error: "映射不完整,拒绝保存", issues },
      { status: 422 },
    );
  }

  // 样例验证:给了样例值就跑一遍转换,失败即拒绝保存
  const sampleFailures: { localField: string; message: string }[] = [];
  const withSample = mappings.map((m) => {
    if (m.sampleValue === undefined || m.sampleValue === null) return { m, sampleResult: null };
    const t = applyTransform(m.sampleValue, m.transform);
    if (!t.ok) sampleFailures.push({ localField: m.localField, message: t.error! });
    return { m, sampleResult: { input: m.sampleValue, output: t.value, ok: t.ok, error: t.error ?? null } };
  });
  if (sampleFailures.length > 0) {
    return NextResponse.json({ error: "样例验证未通过,拒绝保存", issues: sampleFailures }, { status: 422 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.erpFieldMapping.deleteMany({
      where: tenantWhere(auth.session.tenantId, { connectionId: id, entityType }),
    });
    let i = 0;
    for (const { m, sampleResult } of withSample) {
      await tx.erpFieldMapping.create({
        data: tenantData(auth.session.tenantId, {
          connectionId: id,
          entityType,
          erpField: m.erpField,
          localField: m.localField,
          transform: m.transform ?? null,
          defaultValue: m.defaultValue ?? null,
          required: m.required ?? false,
          sampleResult: sampleResult ?? undefined,
          sortOrder: i++,
          createdById: auth.session.userId,
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "ERP_MAPPING_SAVE",
      entityType: "ErpFieldMapping",
      entityId: id,
      after: { entityType, count: mappings.length },
    });
  });

  return NextResponse.json({ ok: true, count: mappings.length });
}
