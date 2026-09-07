import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { ManufacturingInfoSchema, emptyManufacturingInfo } from "@/lib/domain/bom-detail";
import { isFeatureEnabled } from "@/lib/server/tenant-settings";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * F7(T2,Feature Flag `bom.manufacturingInfo`):制造工程信息读写。
 * flag 关闭时 404 —— 关闭的功能不存在,而不是"没权限"。
 * 只做录入与展示;工艺变更审批不在本轮(页面已注明)。
 */
async function guard(versionId: string) {
  const auth = await requireSession();
  if (!auth.ok) return { err: auth.response } as const;
  if (!(await isFeatureEnabled(auth.session.tenantId, "bom.manufacturingInfo"))) {
    return { err: notFound("该功能未启用(租户 Feature Flag bom.manufacturingInfo)") } as const;
  }
  const version = await prisma.bOMVersion.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: versionId }),
    select: { id: true },
  });
  if (!version) return { err: notFound("版本不存在或不属于当前租户") } as const;
  return { session: auth.session } as const;
}

export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const g = await guard(versionId);
  if ("err" in g) return g.err;
  const row = await prisma.bomVersionManufacturingInfo.findFirst({
    where: tenantWhere(g.session.tenantId, { bomVersionId: versionId }),
  });
  if (!row) return NextResponse.json({ info: emptyManufacturingInfo(), exists: false });
  const parsed = ManufacturingInfoSchema.safeParse({
    processRoute: row.processRoute ?? [],
    panelization: row.panelization ?? [],
    stencil: row.stencil ?? [],
    tooling: row.tooling ?? [],
    note: row.note,
  });
  return NextResponse.json({
    info: parsed.success ? parsed.data : emptyManufacturingInfo(),
    exists: true,
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const g = await guard(versionId);
  if ("err" in g) return g.err;
  // 制造工程信息由工程维护;管理层可改
  if (!g.session.roles.some((r) => r === "ENGINEERING" || r === "MANAGEMENT")) {
    return forbidden("仅工程或管理层可维护制造工程信息");
  }

  const parsed = ManufacturingInfoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });
  const info = parsed.data;

  const existing = await prisma.bomVersionManufacturingInfo.findFirst({
    where: tenantWhere(g.session.tenantId, { bomVersionId: versionId }),
  });
  const data = {
    processRoute: info.processRoute as unknown as Prisma.InputJsonValue,
    panelization: info.panelization as unknown as Prisma.InputJsonValue,
    stencil: info.stencil as unknown as Prisma.InputJsonValue,
    tooling: info.tooling as unknown as Prisma.InputJsonValue,
    note: info.note,
    updatedById: g.session.userId,
  };
  const saved = existing
    ? await prisma.bomVersionManufacturingInfo.update({ where: { id: existing.id }, data })
    : await prisma.bomVersionManufacturingInfo.create({
        data: tenantData(g.session.tenantId, { bomVersionId: versionId, ...data }),
      });

  await writeAudit(prisma, {
    tenantId: g.session.tenantId,
    userId: g.session.userId,
    action: "BOM_MANUFACTURING_INFO_UPDATE",
    entityType: "BomVersionManufacturingInfo",
    entityId: saved.id,
    after: {
      versionId,
      processSteps: info.processRoute.length,
      panelization: info.panelization.length,
      stencil: info.stencil.length,
      tooling: info.tooling.length,
    },
  });
  return NextResponse.json({ ok: true, updatedAt: saved.updatedAt.toISOString() });
}
