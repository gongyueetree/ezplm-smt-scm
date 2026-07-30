/**
 * 批量 update 报价(客户 xlsx 新增需求:「批量导入 BOM,生成单个单个 BOM 列明的 update 的报价单」)。
 *
 * 语义是 **update** 而不是"再开一张新报价":
 * - 该 BOM 所属 RFQ+客户**已有报价** → 走 `createRevision` 开新 Revision
 *   (遵守"已批准版本禁止覆盖,改动走新 Revision");
 * - 没有报价 → 才新建报价。
 *
 * 纪律:逐 BOM 独立成败,一条失败不拖垮整批,失败原因逐条留痕。
 */
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { createQuote, createRevision } from "@/lib/server/repositories/quote";
import { generateQuoteLinesFromBom } from "@/lib/server/repositories/quote-from-bom";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export interface BatchUpdateItemResult {
  bomVersionId: string;
  bomName: string;
  ok: boolean;
  /** NEW=新建报价;REVISION=在既有报价上开新版本 */
  mode: "NEW" | "REVISION" | null;
  quoteVersionId: string | null;
  lines: number;
  missingCost: number;
  reason: string | null;
}

export async function runQuoteBatchUpdate(
  session: SessionRef,
  bomVersionIds: string[],
): Promise<{ jobId: string; results: BatchUpdateItemResult[] }> {
  const job = await prisma.quoteBatchUpdateJob.create({
    data: tenantData(session.tenantId, {
      status: "RUNNING",
      totalBoms: bomVersionIds.length,
      createdById: session.userId,
    }),
  });

  const results: BatchUpdateItemResult[] = [];

  for (const versionId of bomVersionIds) {
    const version = await prisma.bOMVersion.findFirst({
      where: tenantWhere(session.tenantId, { id: versionId }),
      include: { bom: { select: { name: true, rfqId: true, customerId: true } } },
    });

    if (!version) {
      results.push({
        bomVersionId: versionId,
        bomName: "(未找到)",
        ok: false,
        mode: null,
        quoteVersionId: null,
        lines: 0,
        missingCost: 0,
        reason: "BOM 版本不存在或不属于当前租户",
      });
      continue;
    }

    const base: Omit<BatchUpdateItemResult, "ok" | "mode" | "quoteVersionId" | "lines" | "missingCost" | "reason"> = {
      bomVersionId: versionId,
      bomName: version.bom.name,
    };

    if (!version.bom.rfqId || !version.bom.customerId) {
      results.push({
        ...base,
        ok: false,
        mode: null,
        quoteVersionId: null,
        lines: 0,
        missingCost: 0,
        reason: "该 BOM 未关联 RFQ 或客户,报价必须归属客户与 RFQ",
      });
      continue;
    }

    // 已有报价 → 开新 Revision(update 语义);否则新建
    const existing = await prisma.quote.findFirst({
      where: tenantWhere(session.tenantId, {
        rfqId: version.bom.rfqId,
        customerId: version.bom.customerId,
      }),
      include: { versions: { orderBy: { revision: "desc" }, take: 1, select: { id: true } } },
      orderBy: { createdAt: "desc" },
    });

    let quoteVersionId: string | null = null;
    let mode: "NEW" | "REVISION" = "NEW";

    if (existing?.versions[0]) {
      mode = "REVISION";
      const rev = await createRevision(session, existing.versions[0].id);
      if (!rev.ok) {
        results.push({
          ...base,
          ok: false,
          mode,
          quoteVersionId: null,
          lines: 0,
          missingCost: 0,
          reason: rev.message,
        });
        continue;
      }
      quoteVersionId = rev.data.versionId;
    } else {
      const created = await createQuote(session, {
        rfqId: version.bom.rfqId,
        customerId: version.bom.customerId,
      });
      quoteVersionId = created.version.id;
    }

    const gen = await generateQuoteLinesFromBom(session, quoteVersionId, versionId);
    results.push({
      ...base,
      ok: gen.ok,
      mode,
      quoteVersionId,
      lines: gen.ok ? gen.count : 0,
      missingCost: gen.ok ? gen.missingCost : 0,
      reason: gen.ok ? (gen.note ?? null) : gen.reason,
    });

    await prisma.quoteBatchUpdateJob.update({
      where: { id: job.id },
      data: { processedBoms: results.length },
    });
  }

  const failed = results.filter((r) => !r.ok).length;
  await prisma.$transaction(async (tx) => {
    await tx.quoteBatchUpdateJob.update({
      where: { id: job.id },
      data: {
        // 有失败也算作业跑完了 —— 逐条结果里写明谁失败,不用整体状态掩盖细节
        status: "SUCCEEDED",
        processedBoms: results.length,
        results: results as unknown as Prisma.InputJsonValue,
        error: failed > 0 ? `${failed} 个 BOM 未成功,详见逐条结果` : null,
      },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "QUOTE_BATCH_UPDATE",
      entityType: "QuoteBatchUpdateJob",
      entityId: job.id,
      after: { total: bomVersionIds.length, failed },
    });
  });

  return { jobId: job.id, results };
}
