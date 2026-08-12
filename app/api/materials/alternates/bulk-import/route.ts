import { NextResponse } from "next/server";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import {
  normalizePn,
  parseAlternateImportGrid,
  resolveRows,
  type AlternateRowError,
} from "@/lib/domain/alternate-bulk";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { extractRows } from "@/lib/server/file-parse";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/** 一次最多导入的行数 —— 超过时**明说**,不静默只处理前 N 行 */
const MAX_ROWS = 2000;
/** 物料表扫描上限(用于把内部料号解析成 partId) */
const PART_SCAN_CAP = 50_000;

/**
 * E3:替代料批量导入(客户 Q9)。
 *
 * 流程按客户要求:上传 → 预览 → 校验 → 人工确认 → 执行。
 * `execute=false`(默认)只解析不落库。
 *
 * 纪律:
 * - **逐行报错**,不是整批一句"格式不对";
 * - **不自动新建 Part**;
 * - **有任何行出错时,默认整批不执行** —— 替代关系是拿去换料的依据,
 *   半批导入会让人以为全导进去了。要强行只导好行,得显式 `allowPartial`。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "ENGINEERING" || r === "PM" || r === "MANAGEMENT")) {
    return forbidden("替代关系由工程维护", "alternate_role");
  }

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("需要 multipart/form-data");
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("未选择文件");
  const execute = String(form.get("execute") ?? "") === "true";
  const allowPartial = String(form.get("allowPartial") ?? "") === "true";

  const buffer = Buffer.from(await file.arrayBuffer());
  const extracted = await extractRows(file.name, buffer, file.type);
  if (extracted.rows.length === 0) {
    return NextResponse.json(
      { error: extracted.note ?? "未能从文件里解析出表格内容" },
      { status: 422 },
    );
  }

  const parsed = parseAlternateImportGrid(extracted.rows);
  if (parsed.fatal) {
    return NextResponse.json({ error: parsed.fatal, mapping: parsed.mapping }, { status: 422 });
  }
  if (parsed.rows.length + parsed.errors.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `一次最多导入 ${MAX_ROWS} 行,本次 ${parsed.rows.length + parsed.errors.length} 行 —— 请拆分后再导` },
      { status: 422 },
    );
  }

  // 内部料号 → partId。**只查不建**
  const parts = await prisma.part.findMany({
    where: tenantWhere(auth.session.tenantId),
    select: { id: true, internalPn: true },
    take: PART_SCAN_CAP + 1,
  });
  const scanTruncated = parts.length > PART_SCAN_CAP;
  const partIdByInternalPn = new Map(
    parts.slice(0, PART_SCAN_CAP).map((p) => [normalizePn(p.internalPn), p.id]),
  );

  const { resolved, errors: resolveErrors } = resolveRows(parsed.rows, { partIdByInternalPn });
  const errors: AlternateRowError[] = [...parsed.errors, ...resolveErrors].sort(
    (a, b) => a.rowNo - b.rowNo,
  );

  const preview = {
    total: parsed.rows.length + parsed.errors.length,
    ok: resolved.length,
    failed: errors.length,
    errors: errors.slice(0, 200),
    errorsTruncated: errors.length > 200,
    scanTruncated,
    scanNote: scanTruncated
      ? `物料超过 ${PART_SCAN_CAP} 条,料号解析只覆盖了前 ${PART_SCAN_CAP} 条 —— 报「不存在」的行未必真的不存在。`
      : null,
    sample: resolved.slice(0, 20),
  };

  if (!execute) {
    return NextResponse.json({ preview, executed: false, note: "预览完成 —— **未写入任何替代关系**" });
  }

  if (errors.length > 0 && !allowPartial) {
    return NextResponse.json(
      {
        preview,
        executed: false,
        error: `有 ${errors.length} 行未通过校验,整批未执行。替代关系是换料依据,半批导入会让人以为全导进去了 —— 请修好后重传,或显式选择「只导入通过校验的行」。`,
        code: "has_errors",
      },
      { status: 422 },
    );
  }

  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const row of resolved) {
    const existing = await prisma.partAlternate.findFirst({
      where: tenantWhere(auth.session.tenantId, {
        partId: row.basePartId,
        alternatePartId: row.altPartId,
      }),
      select: { id: true },
    });
    await prisma.partAlternate.upsert({
      where: {
        tenantId_partId_alternatePartId: {
          tenantId: auth.session.tenantId,
          partId: row.basePartId,
          alternatePartId: row.altPartId,
        },
      },
      update: {
        functionalEquivalence: row.functional as never,
        packageCompatibility: row.packageCompat as never,
        pinCompatibility: row.pin as never,
        reason: row.reason,
        evidenceSource: row.source,
        note: row.note,
        approvedById: auth.session.userId,
        approvedAt: now,
      },
      create: tenantData(auth.session.tenantId, {
        partId: row.basePartId,
        alternatePartId: row.altPartId,
        functionalEquivalence: row.functional as never,
        packageCompatibility: row.packageCompat as never,
        pinCompatibility: row.pin as never,
        reason: row.reason,
        evidenceSource: row.source,
        note: row.note,
        approvedById: auth.session.userId,
        approvedAt: now,
      }),
    });
    if (existing) updated += 1;
    else created += 1;
  }

  await writeAudit(prisma, {
    tenantId: auth.session.tenantId,
    userId: auth.session.userId,
    action: "PART_ALTERNATE_BULK_IMPORT",
    entityType: "PartAlternate",
    entityId: `bulk:${file.name}`,
    after: { fileName: file.name, created, updated, failed: errors.length, allowPartial },
  });

  return NextResponse.json({
    preview,
    executed: true,
    created,
    updated,
    note:
      errors.length > 0
        ? `已导入 ${created + updated} 条(新增 ${created} / 更新 ${updated});**另有 ${errors.length} 行未导入**,原因见错误清单。`
        : `已导入 ${created + updated} 条(新增 ${created} / 更新 ${updated})。`,
  });
}
