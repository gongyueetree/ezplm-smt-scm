import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import { detectDelimiter, parseCsv } from "@/lib/domain/csv";
import { cellText, detectVocabularyMapping, missingFields, type ColumnVocabulary } from "@/modules/tabular/domain/column-mapping";
import { SCRAP_VOCABULARY } from "@/modules/tabular/vocabularies/scrap";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData } from "@/lib/server/tenant-scope";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

type Field = "period" | "customerId" | "workOrder" | "mpn" | "issuedQty" | "scrapQty" | "reason";

const VOCABULARY: ColumnVocabulary<Field> = SCRAP_VOCABULARY;

const REQUIRED = VOCABULARY.required;

const Input = z.object({ text: z.string().min(1).max(2_000_000), period: z.string().trim().max(20).optional() });

/**
 * 导入损耗数据。
 *
 * 数据主权:真实投料/报废在 MES/ERP,本系统没有工单投料 ——
 * 一期只做导入+分析+导出,来源如实记为 IMPORTED。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const text = parsed.data.text.trim();
  const rows = parseCsv(text, detectDelimiter(text)).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return badRequest("未能从输入中解析出表格");

  const mapping = detectVocabularyMapping(rows, VOCABULARY);
  const missing = missingFields(mapping, REQUIRED);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `缺少必需列:${missing.join("、")}(至少要有发料数量与报废数量)` },
      { status: 422 },
    );
  }

  const num = (raw: string): string | null => {
    const t = raw.trim().replace(/,/g, "");
    if (!t) return null;
    return /^\d+(\.\d+)?$/.test(t) ? t : null;
  };

  const errors: { row: number; message: string }[] = [];
  const toCreate: {
    period: string;
    customerId: string | null;
    workOrder: string | null;
    mpn: string | null;
    issuedQty: string;
    scrapQty: string;
    reason: string | null;
  }[] = [];

  for (let i = mapping.headerRowIndex + 1; i < rows.length; i += 1) {
    const get = (f: Field) => cellText(rows[i], mapping.fields[f]) ?? "";
    const issued = num(get("issuedQty"));
    const scrap = num(get("scrapQty"));
    if (issued === null && scrap === null) continue;
    if (scrap === null) {
      errors.push({ row: i + 1, message: "报废数量缺失或非法" });
      continue;
    }
    if (issued === null) {
      // 发料缺失不阻断:损耗率会如实标为不可算,而不是按 0 处理
      errors.push({ row: i + 1, message: "发料数量缺失 —— 该行损耗率将不可算(仍会入库)" });
    }
    toCreate.push({
      period: get("period").trim() || parsed.data.period?.trim() || "未标注",
      customerId: get("customerId").trim() || null,
      workOrder: get("workOrder").trim() || null,
      mpn: get("mpn").trim() || null,
      issuedQty: issued ?? "0",
      scrapQty: scrap,
      reason: get("reason").trim() || null,
    });
  }

  if (toCreate.length === 0) {
    return NextResponse.json({ error: "没有可导入的数据行", errors }, { status: 422 });
  }

  await prisma.$transaction(async (tx) => {
    for (const r of toCreate) {
      await tx.scrapRecord.create({
        data: tenantData(auth.session.tenantId, {
          ...r,
          issuedQty: new Prisma.Decimal(r.issuedQty),
          scrapQty: new Prisma.Decimal(r.scrapQty),
          createdById: auth.session.userId,
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "SCRAP_IMPORT",
      entityType: "ScrapRecord",
      entityId: "batch",
      after: { count: toCreate.length },
    });
  });

  return NextResponse.json({ imported: toCreate.length, notices: errors });
}
