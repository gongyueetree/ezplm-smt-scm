import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { compareBomVersions } from "@/lib/domain/bom-compare";
import type { ParsedBomLine } from "@/lib/domain/bom-parse";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const Input = z.object({
  fromVersionId: z.string().min(1),
  toVersionId: z.string().min(1),
});

async function loadLines(tenantId: string, versionId: string): Promise<ParsedBomLine[]> {
  const rows = await prisma.bOMLine.findMany({
    where: tenantWhere(tenantId, { bomVersionId: versionId }),
    orderBy: { lineNo: "asc" },
  });
  return rows.map((l) => ({
    sourceRow: l.lineNo,
    lineNo: l.lineNo,
    refDes: l.refDes,
    qty: Number(l.qty),
    mpn: l.mpn,
    manufacturer: l.manufacturer,
    customerPn: l.customerPn,
    internalPn: null,
    description: l.description,
    footprint: l.footprint,
    issues: [],
  }));
}

/**
 * 保存一次版本比对到台账(客户 docx:「增加历史比对记录台账,每次比对需要重新选择版本,
 * 历史快照留存」)。
 *
 * 存的是**当时的差异快照** —— 两个版本之后再变也不影响这条记录;
 * 台账里可一键回到同一对版本,不用每次重新选。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");
  const { fromVersionId, toVersionId } = parsed.data;
  if (fromVersionId === toVersionId) return badRequest("两侧版本相同,无需比对");

  const versions = await prisma.bOMVersion.findMany({
    where: tenantWhere(auth.session.tenantId, { id: { in: [fromVersionId, toVersionId] } }),
    include: { bom: { select: { name: true } } },
  });
  if (versions.length !== 2) return badRequest("版本不存在或不属于当前租户");

  const from = versions.find((v) => v.id === fromVersionId)!;
  const to = versions.find((v) => v.id === toVersionId)!;

  // 直接用领域函数已经算好的 summary,不在这里重数一遍 —— 两处各数一次迟早会不一致
  const diff = compareBomVersions(
    await loadLines(auth.session.tenantId, fromVersionId),
    await loadLines(auth.session.tenantId, toVersionId),
  );

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.bomCompareRun.create({
      data: tenantData(auth.session.tenantId, {
        fromVersionId,
        toVersionId,
        label: `${from.bom.name} V${from.versionNo} → ${to.bom.name} V${to.versionNo}`,
        addedCount: diff.summary.added,
        removedCount: diff.summary.removed,
        qtyChangedCount: diff.summary.qtyChanged,
        partChangedCount: diff.summary.partChanged,
        unchangedCount: diff.summary.unchanged,
        snapshot: { entries: diff.entries, summary: diff.summary } as unknown as Prisma.InputJsonValue,
        createdById: auth.session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "BOM_COMPARE_SAVE",
      entityType: "BomCompareRun",
      entityId: created.id,
      after: {
        label: created.label,
        changed:
          diff.summary.added +
          diff.summary.removed +
          diff.summary.qtyChanged +
          diff.summary.partChanged,
      },
    });
    return created;
  });

  return NextResponse.json({ id: run.id, label: run.label }, { status: 201 });
}
