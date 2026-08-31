import { NextResponse } from "next/server";
import { badRequest, forbidden, guardMultipartSize, requireSession } from "@/lib/server/api";
import { parseShortageSheet } from "@/lib/domain/shortage-sheet";
import { extractRows } from "@/lib/server/file-parse";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * PR2-PROC-10:缺料分析单导入。
 *
 * 客户原话:「缺料分析是根据**缺料分析单**来的,而非 BOM」。
 * 所以这里进来的是**业务事实**,不是推算结果 —— 系统不拿库存缓存去纠正它。
 *
 * 与物料/供应商导入同一套形态:上传 xlsx/csv → 复用 extractRows → 预览 → 执行。
 */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const sheets = await prisma.shortageSheet.findMany({
    where: tenantWhere(auth.session.tenantId),
    orderBy: { sheetDate: "desc" },
    take: 50,
    include: { _count: { select: { lines: true } } },
  });
  return NextResponse.json({ sheets });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT" || r === "PM")) {
    return forbidden("仅 PM / 采购 / 管理层可导入缺料单");
  }

  // E9:读 body 之前先按中间件 10MB 上限拒 —— 截断后的报错会误导人(见 guardMultipartSize)
  const oversize = guardMultipartSize(req);
  if (oversize) return oversize;
  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("需要 multipart/form-data");
  const upload = form.get("file");
  if (!(upload instanceof File)) return badRequest("未选择文件");
  const mode = form.get("mode") === "EXECUTE" ? "EXECUTE" : "PREVIEW";
  const sheetDateRaw = (form.get("sheetDate") as string) || "";

  const buffer = Buffer.from(await upload.arrayBuffer());
  const extracted = await extractRows(upload.name, buffer, upload.type);
  if (extracted.rows.length === 0) {
    return NextResponse.json(
      { error: extracted.note ?? `${upload.name}:未能从文件中解析出表格内容` },
      { status: 422 },
    );
  }

  const parsed = parseShortageSheet(extracted.rows);
  const notices = [...parsed.notices];
  if (extracted.isDraft || extracted.source === "ocr") {
    notices.unshift(
      `内容来自${extracted.source === "ocr" ? "图片识别" : "PDF 文本层重建"},属草稿,请逐行核对后再执行。`,
    );
  }

  if (mode === "PREVIEW") {
    return NextResponse.json({
      mode: "PREVIEW",
      lines: parsed.lines.slice(0, 200),
      lineCount: parsed.lines.length,
      errors: parsed.errors,
      notices,
      note: "预览只解析,未创建任何缺料单",
    });
  }

  /*
   * 有解析错误就整批拒绝。
   * 缺料单会直接驱动 Call 料与催供应商,导进去一半等于让采购
   * 对着一份不完整的清单去要货。
   */
  if (parsed.errors.length > 0) {
    return NextResponse.json(
      { error: `文件里有 ${parsed.errors.length} 处问题,已全部拒绝导入 —— 修好后重传`, errors: parsed.errors, notices },
      { status: 422 },
    );
  }

  const sheetDate = /^\d{4}-\d{2}-\d{2}$/.test(sheetDateRaw)
    ? new Date(`${sheetDateRaw}T00:00:00Z`)
    : new Date();

  // 客户/供应商按名称匹配;匹配不到留空并在行上保留原文,**不自动建档**
  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({ where: tenantWhere(auth.session.tenantId), select: { id: true, name: true, code: true } }),
    prisma.supplier.findMany({ where: tenantWhere(auth.session.tenantId), select: { id: true, name: true, code: true } }),
  ]);
  const findId = (rows: { id: string; name: string; code: string }[], v: string | null) => {
    if (!v) return null;
    const t = v.trim().toLowerCase();
    return rows.find((r) => r.name.toLowerCase() === t || r.code.toLowerCase() === t)?.id ?? null;
  };

  const code = `SS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const created = await prisma.$transaction(async (tx) => {
    const sheet = await tx.shortageSheet.create({
      data: tenantData(auth.session.tenantId, {
        code,
        source: "EXCEL_IMPORT",
        sheetDate,
        createdById: auth.session.userId,
      }),
    });
    for (const l of parsed.lines) {
      await tx.shortageSheetLine.create({
        data: tenantData(auth.session.tenantId, {
          sheetId: sheet.id,
          customerId: findId(customers, l.customer),
          internalPn: l.internalPn,
          manufacturer: l.manufacturer,
          mpn: l.mpn,
          requiredQty: l.requiredQty,
          availableInventory: l.availableInventory,
          openPoQty: l.openPoQty,
          eta: l.eta ? new Date(`${l.eta}T00:00:00Z`) : null,
          supplierId: findId(suppliers, l.supplier),
          shortageQty: l.shortageQty,
          requiredDate: l.requiredDate ? new Date(`${l.requiredDate}T00:00:00Z`) : null,
          status: "OPEN",
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "SHORTAGE_SHEET_IMPORT",
      entityType: "ShortageSheet",
      entityId: sheet.id,
      after: { code, lineCount: parsed.lines.length, source: "EXCEL_IMPORT" },
    });
    return sheet;
  });

  return NextResponse.json(
    { mode: "EXECUTE", sheet: created, lineCount: parsed.lines.length, notices, note: `已导入缺料单 ${code},共 ${parsed.lines.length} 行` },
    { status: 201 },
  );
}
