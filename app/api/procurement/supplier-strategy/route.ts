import { NextResponse } from "next/server";
import { forbidden, requireSession } from "@/lib/server/api";
import {
  commitStrategyImport,
  exportStrategiesXlsx,
  listStrategies,
  previewStrategyImport,
} from "@/lib/server/repositories/supplier-strategy";

export const runtime = "nodejs";

function canManage(roles: readonly string[]): boolean {
  return roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT");
}

/** R4-6(§31):策略列表(?partId= 过滤)或 Excel 导出(?export=1) */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!canManage(auth.session.roles)) return forbidden("采购策略属采购/管理层");
  const url = new URL(req.url);
  if (url.searchParams.get("export") === "1") {
    const buf = await exportStrategiesXlsx(auth.session);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="supplier-strategy.xlsx"',
      },
    });
  }
  const rows = await listStrategies(auth.session, url.searchParams.get("partId") ?? undefined);
  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      internalPn: r.part.internalPn,
      supplierId: r.supplierId,
      partMfgMappingId: r.partMfgMappingId,
      priority: r.priority,
      isPreferred: r.isPreferred,
      isApproved: r.isApproved,
      isBlocked: r.isBlocked,
      moq: r.moq?.toString() ?? null,
      spq: r.spq?.toString() ?? null,
      leadTimeDays: r.leadTimeDays,
      allocationPercent: r.allocationPercent?.toString() ?? null,
      effectiveFrom: r.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      effectiveTo: r.effectiveTo?.toISOString().slice(0, 10) ?? null,
      note: r.note,
    })),
  });
}

/**
 * R4-6(§31):批量导入。multipart file;?confirm=1 时先 preview 再事务提交;
 * 默认仅 preview。任何 invalid 行存在 → 不允许提交(策略不允许部分成功)。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!canManage(auth.session.roles)) return forbidden("采购策略属采购/管理层");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const preview = await previewStrategyImport(auth.session, buf);
  const confirm = new URL(req.url).searchParams.get("confirm") === "1";
  if (!confirm) {
    return NextResponse.json({
      preview: {
        valid: preview.valid,
        invalid: preview.invalid,
        creates: preview.creates,
        updates: preview.updates,
        conflicts: preview.conflicts,
        issues: preview.rows
          .filter((r) => r.issues.length > 0)
          .slice(0, 50)
          .map((r) => ({ row: r.row, issues: r.issues })),
      },
    });
  }
  const result = await commitStrategyImport(auth.session, preview);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });
  return NextResponse.json({ ok: true, created: result.created, updated: result.updated });
}
