import { NextResponse } from "next/server";
import { badRequest, forbidden, guardMultipartSize, requireSession } from "@/lib/server/api";
import { parseSupplierOfferGrid } from "@/lib/domain/supplier-offer-import";
import { extractRows } from "@/lib/server/file-parse";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { upsertSupplierOffer } from "@/lib/server/repositories/procurement";

export const runtime = "nodejs";

/**
 * N-9(客户 PR2 反馈 采购-6B:「供应商与采购策略…需要批量导入」)。
 *
 * 与物料批量导入(N-3)保持同一套形态:
 * - 上传 xlsx/csv,复用 extractRows,不另写解析;
 * - **预览与执行分离**:先看清楚会建多少、哪几行有问题,再决定写不写;
 * - 供应商按**编码**匹配。匹配不到的行**报错而不是自动建供应商** ——
 *   凭一个表格里的编码自动新建往来单位,等于让导入文件决定主数据。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可维护供应商预设");
  }

  // E9:读 body 之前先按中间件 10MB 上限拒 —— 截断后的报错会误导人(见 guardMultipartSize)
  const oversize = guardMultipartSize(req);
  if (oversize) return oversize;
  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("需要 multipart/form-data");
  const upload = form.get("file");
  if (!(upload instanceof File)) return badRequest("未选择文件");
  const mode = form.get("mode") === "EXECUTE" ? "EXECUTE" : "PREVIEW";

  const buffer = Buffer.from(await upload.arrayBuffer());
  const extracted = await extractRows(upload.name, buffer, upload.type);
  if (extracted.rows.length === 0) {
    return NextResponse.json(
      {
        error: extracted.note ?? `${upload.name}:未能从文件中解析出表格内容`,
        requiresManualTranscription: extracted.requiresManualTranscription,
      },
      { status: 422 },
    );
  }

  const parsedFile = parseSupplierOfferGrid(extracted.rows);
  const notices = [...parsedFile.notices];
  if (extracted.isDraft || extracted.source === "ocr") {
    notices.unshift(
      `内容来自${extracted.source === "ocr" ? "图片识别" : "PDF 文本层重建"},属**草稿**,请逐行核对后再执行。`,
    );
  }

  // 供应商按编码匹配 —— 匹配不到就报错,绝不自动建
  const codes = [...new Set(parsedFile.groups.map((g) => g.supplierCode))];
  const suppliers = codes.length
    ? await prisma.supplier.findMany({
        where: tenantWhere(auth.session.tenantId, { code: { in: codes } }),
        select: { id: true, code: true, name: true, isActive: true },
      })
    : [];
  const byCode = new Map(suppliers.map((s) => [s.code, s]));

  const errors = [...parsedFile.errors];
  const plan = parsedFile.groups.map((g) => {
    const sup = byCode.get(g.supplierCode);
    let outcome: "WILL_UPSERT" | "BLOCKED_NO_SUPPLIER" | "BLOCKED_SUPPLIER_INACTIVE" =
      "WILL_UPSERT";
    let reason: string | null = null;
    if (!sup) {
      outcome = "BLOCKED_NO_SUPPLIER";
      reason = `供应商编码「${g.supplierCode}」在主数据里不存在 —— 请先建供应商,导入不会自动创建往来单位`;
    } else if (!sup.isActive) {
      outcome = "BLOCKED_SUPPLIER_INACTIVE";
      reason = `供应商「${sup.name}」已停用`;
    }
    if (reason) errors.push({ row: g.sourceRows[0], message: reason });
    return {
      supplierCode: g.supplierCode,
      supplierName: sup?.name ?? null,
      mpn: g.mpn,
      breakCount: g.priceBreaks.length,
      sourceRows: g.sourceRows,
      outcome,
      reason,
    };
  });

  const willUpsert = plan.filter((p) => p.outcome === "WILL_UPSERT").length;

  if (mode === "PREVIEW") {
    return NextResponse.json({
      mode: "PREVIEW",
      plan,
      willUpsert,
      blocked: plan.length - willUpsert,
      errors,
      notices,
      note: "预览只计算计划,**未写入任何供应商预设**",
    });
  }

  /*
   * 有解析错误时**拒绝执行**。
   * 部分成功会留下一份"导进去了一半"的价格表,而比价照样会用它出结论 ——
   * 宁可让人先把文件改对。
   */
  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: `文件里有 ${errors.length} 处问题,已全部拒绝导入 —— 修好后重传`,
        plan,
        errors,
        notices,
      },
      { status: 422 },
    );
  }

  let upserted = 0;
  for (const g of parsedFile.groups) {
    const sup = byCode.get(g.supplierCode)!;
    await upsertSupplierOffer(auth.session, {
      supplierId: sup.id,
      mpn: g.mpn,
      manufacturer: g.manufacturer,
      currency: g.currency,
      moq: g.moq,
      spq: g.spq,
      leadTimeDays: g.leadTimeDays,
      priceBreaks: g.priceBreaks,
    });
    upserted++;
  }

  return NextResponse.json(
    { mode: "EXECUTE", plan, upserted, errors, notices, note: `已写入 ${upserted} 条供应商预设` },
    { status: 201 },
  );
}
