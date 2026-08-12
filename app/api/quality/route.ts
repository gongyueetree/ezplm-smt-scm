import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { can } from "@/lib/server/permissions";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const CAP = 500;

const EVENT_TYPES = ["INCOMING", "PROCESS", "CUSTOMER_COMPLAINT", "SUPPLIER", "TRACE_INCIDENT", "OTHER"] as const;
const STATUSES = ["OPEN", "INVESTIGATING", "CONTAINED", "CLOSED"] as const;

/**
 * E6:**最小品质模块**(客户 Q12:「质量事件由品质录入」;
 * 客户同时问「没有品质模块,该如何导入质量事件或者备注?」)。
 *
 * 刻意**不做完整 QMS**:客户要的是"品质能把事件记下来并和追溯挂上",
 * 不是 8D/CAPA/SPC 那一整套。做大了既交付不了,也没人用。
 *
 * 权限而非角色:`quality.*` 默认给 MANAGEMENT,具体到人由 UserPermission 授予 ——
 * 品质专员不必是管理层,也不必为此改 RoleName 枚举。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!(await can(auth.session, "quality.view"))) {
    return forbidden("需要品质查看权限(quality.view)", "quality_permission");
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");

  const rows = await prisma.qualityIncident.findMany({
    where: tenantWhere(auth.session.tenantId, {
      ...(type && (EVENT_TYPES as readonly string[]).includes(type) ? { eventType: type as never } : {}),
      ...(status && (STATUSES as readonly string[]).includes(status) ? { status: status as never } : {}),
    }),
    orderBy: { createdAt: "desc" },
    take: CAP + 1,
  });

  return NextResponse.json({
    items: rows.slice(0, CAP),
    truncated: rows.length > CAP,
    truncationNote:
      rows.length > CAP ? `质量事件超过 ${CAP} 条,本次只返回最近 ${CAP} 条 —— 不是"只有这些"。` : null,
  });
}

const Input = z.object({
  title: z.string().min(1).max(200),
  eventType: z.enum(EVENT_TYPES),
  severity: z.string().max(20).nullable().optional(),
  sourceRef: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  customerId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  partId: z.string().nullable().optional(),
  mpn: z.string().max(120).nullable().optional(),
  lotId: z.string().max(120).nullable().optional(),
  sn: z.string().max(120).nullable().optional(),
  detectedAt: z.string().nullable().optional(),
  traceAnalysisId: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!(await can(auth.session, "quality.create"))) {
    return forbidden("需要品质录入权限(quality.create)", "quality_permission");
  }

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });
  const d = parsed.data;

  // 客诉必须挂客户,供应商问题必须挂供应商 —— 否则事后统计不出"哪个客户投诉多"
  if (d.eventType === "CUSTOMER_COMPLAINT" && !d.customerId) {
    return badRequest("客诉必须选择客户 —— 否则统计不出是哪个客户的问题");
  }
  if (d.eventType === "SUPPLIER" && !d.supplierId) {
    return badRequest("供应商问题必须选择供应商");
  }

  const code = `QI-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()
    .toString(36)
    .toUpperCase()
    .slice(-5)}`;

  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.qualityIncident.create({
      data: tenantData(auth.session.tenantId, {
        code,
        title: d.title.trim(),
        eventType: d.eventType,
        severity: d.severity ?? null,
        // sourceRef 是既有必填字段;没有具体来源时记事件自身编号,不留空串
        sourceRef: d.sourceRef?.trim() || code,
        description: d.description ?? null,
        customerId: d.customerId ?? null,
        supplierId: d.supplierId ?? null,
        partId: d.partId ?? null,
        mpn: d.mpn ?? null,
        lotId: d.lotId ?? null,
        // SN 没有就是没有 —— 系统不产生 SN(见 lib/providers/mes)
        sn: d.sn?.trim() || null,
        detectedAt: d.detectedAt ? new Date(d.detectedAt) : null,
        traceAnalysisId: d.traceAnalysisId ?? null,
        status: "OPEN",
        reportedById: auth.session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "QUALITY_INCIDENT_CREATE",
      entityType: "QualityIncident",
      entityId: r.id,
      after: { code, eventType: d.eventType, title: d.title, sn: d.sn ?? null },
    });
    return r;
  });

  return NextResponse.json(
    {
      incident: row,
      note: row.sn
        ? "已记录。SN 为人工填写 —— 系统不产生 SN,SN 级追溯仍需 MES 接入。"
        : "已记录。",
    },
    { status: 201 },
  );
}
