/**
 * 采购 RFQ 数据访问(SPEC §11)。
 * 纪律:tenant 守卫 + 事务内 AuditLog;异常判定与选型校验一律走领域函数,本层只落库。
 */
import type { Prisma } from "@prisma/client";
import { checkUsablePrice } from "@/lib/domain/price-guard";
import {
  evaluateFlags,
  persistedProgress,
  validateResolution,
  type FlaggedLineState,
  type FlagThresholds,
  type QuoteSnapshot,
} from "@/lib/domain/procurement-flags";
import { buildComparisonSet, type SourcingModeValue } from "@/lib/domain/sourcing";
import { getDigiKeyProvider } from "@/lib/providers/digikey";
import { getMouserProvider } from "@/lib/providers/mouser";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";
import { ProviderError } from "@/lib/providers/common/errors";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { SessionRef } from "./rfq";

/** 采购 RFQ 编号:PRFQ-YYYYMMDD-NNN(与 RFQ 同款,冲突重试) */
async function nextCode(tenantId: string, now: Date): Promise<string> {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefix = `PRFQ-${stamp}-`;
  const last = await prisma.procurementRFQ.findFirst({
    where: tenantWhere(tenantId, { code: { startsWith: prefix } }),
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const seq = last ? Number(last.code.slice(prefix.length)) : 0;
  return `${prefix}${String(Number.isFinite(seq) ? seq + 1 : 0 + 1).padStart(3, "0")}`;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export interface CreateProcurementRfqInput {
  rfqId?: string | null;
  bomVersionIds: string[];
  sourcingMode: SourcingModeValue;
}

/** 接收 PM 的一个或多个 BOM,建立采购 RFQ(原始客户 BOM 保留在 BOM 侧,不复制) */
export async function createProcurementRfq(
  session: SessionRef,
  input: CreateProcurementRfqInput,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const code = await nextCode(session.tenantId, new Date());
      return await prisma.$transaction(async (tx) => {
        const prfq = await tx.procurementRFQ.create({
          data: tenantData(session.tenantId, {
            code,
            rfqId: input.rfqId ?? null,
            bomVersionIds: input.bomVersionIds as Prisma.InputJsonValue,
            status: "DRAFT",
            sourcingMode: input.sourcingMode,
            createdById: session.userId,
          }),
        });
        await writeAudit(tx, {
          tenantId: session.tenantId,
          userId: session.userId,
          action: "PROCUREMENT_RFQ_CREATE",
          entityType: "ProcurementRFQ",
          entityId: prfq.id,
          after: { code, bomVersionIds: input.bomVersionIds, mode: input.sourcingMode },
        });
        return prfq;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("采购 RFQ 编号生成失败(并发冲突重试耗尽)");
}

export async function getProcurementRfq(session: SessionRef, id: string) {
  return prisma.procurementRFQ.findFirst({
    where: tenantWhere(session.tenantId, { id }),
    include: {
      supplierQuotes: {
        include: { lines: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function listProcurementRfqs(session: SessionRef) {
  return prisma.procurementRFQ.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { supplierQuotes: true } } },
  });
}

/** 从采购 RFQ 关联的 BOM 版本取出待询价的料(经人工确认的决定优先) */
export async function loadSourcingLines(session: SessionRef, prfqId: string) {
  const prfq = await prisma.procurementRFQ.findFirst({
    where: tenantWhere(session.tenantId, { id: prfqId }),
  });
  if (!prfq) return null;
  const versionIds = Array.isArray(prfq.bomVersionIds) ? (prfq.bomVersionIds as string[]) : [];
  if (versionIds.length === 0) return { prfq, lines: [] };

  const lines = await prisma.bOMLine.findMany({
    where: tenantWhere(session.tenantId, { bomVersionId: { in: versionIds } }),
    orderBy: [{ bomVersionId: "asc" }, { lineNo: "asc" }],
  });
  return { prfq, lines };
}

export interface SourcingRunResult {
  mpn: string;
  manufacturer: string | null;
  demandQty: number;
  offers: NormalizedOffer[];
  degraded: { provider: string; kind: string; message: string }[];
}

/**
 * 三方询价(ezPLM 的库存/主数据已在 BOM 匹配阶段取得,此处取分销商正式价格与库存)。
 * 失败一律降级为结构化信息,不阻断其余料号(SPEC §8)。
 */
export async function runSourcing(
  mpn: string,
  manufacturer: string | null,
  demandQty: number,
): Promise<SourcingRunResult> {
  const offers: NormalizedOffer[] = [];
  const degraded: SourcingRunResult["degraded"] = [];
  for (const provider of [getDigiKeyProvider(), getMouserProvider()]) {
    try {
      const got = await provider.getOffersByMpn({
        mpn,
        manufacturer: manufacturer ?? undefined,
        quantity: demandQty,
      });
      offers.push(...got);
    } catch (e) {
      degraded.push(
        e instanceof ProviderError
          ? { provider: e.provider, kind: e.kind, message: e.message }
          : { provider: provider.name, kind: "unknown", message: String(e) },
      );
    }
  }
  return { mpn, manufacturer, demandQty, offers, degraded };
}

export interface OfflineQuoteLineInput {
  mpn: string;
  manufacturer?: string | null;
  unitPrice: string;
  currency: string;
  moq?: number | null;
  spq?: number | null;
  leadTimeDays?: number | null;
  bomLineId?: string | null;
}

export interface ImportOfflineQuoteInput {
  procurementRfqId: string;
  supplierId: string;
  currency: string;
  sourceFileKey?: string | null;
  quotedAt: Date;
  lines: OfflineQuoteLineInput[];
  thresholds: FlagThresholds;
}

/**
 * 导入线下供应商 Excel(SPEC §11)。
 * 关键:**落库当刻固化原始异常集合**(wasFlagged / flagReasons),
 * 此后阈值如何变化都不再改写(CLAUDE.md 铁律 1)。
 */
export async function importOfflineQuote(session: SessionRef, input: ImportOfflineQuoteInput) {
  const prfq = await prisma.procurementRFQ.findFirst({
    where: tenantWhere(session.tenantId, { id: input.procurementRfqId }),
    select: { id: true, sourcingMode: true },
  });
  if (!prfq) return null;

  // R0-8:线下报价同样不得落 0 —— 解析层(supplier-quote-parse)已拒,
  // 这里是落库前的不变量兜底;REF-3 会把本通道并入价格池,届时更不能带 0 进去。
  for (const l of input.lines) {
    const check = checkUsablePrice(l.unitPrice);
    if (!check.ok) throw new Error(`线下报价落库被拒:${check.message}(MPN=${l.mpn})`);
  }

  return prisma.$transaction(async (tx) => {
    const quote = await tx.supplierQuote.create({
      data: tenantData(session.tenantId, {
        procurementRfqId: input.procurementRfqId,
        supplierId: input.supplierId,
        provider: "OFFLINE",
        currency: input.currency,
        sourceFileKey: input.sourceFileKey ?? null,
        quotedAt: input.quotedAt,
      }),
    });

    let flaggedCount = 0;
    for (const l of input.lines) {
      const snapshot: QuoteSnapshot = {
        supplierId: input.supplierId,
        unitPrice: l.unitPrice,
        currency: l.currency,
        moq: l.moq ?? null,
        spq: l.spq ?? null,
        leadTimeDays: l.leadTimeDays ?? null,
        quotedAt: input.quotedAt.toISOString(),
      };
      const { flagged, reasons } = evaluateFlags(snapshot, input.thresholds);
      if (flagged) flaggedCount += 1;

      await tx.supplierQuoteLine.create({
        data: tenantData(session.tenantId, {
          supplierQuoteId: quote.id,
          bomLineId: l.bomLineId ?? null,
          mpn: l.mpn,
          manufacturer: l.manufacturer ?? null,
          unitPrice: l.unitPrice,
          currency: l.currency,
          moq: l.moq ?? null,
          spq: l.spq ?? null,
          leadTimeDays: l.leadTimeDays ?? null,
          sourcingMode: prfq.sourcingMode,
          quotedAt: input.quotedAt,
          wasFlagged: flagged,
          flagReasons: (reasons as unknown as Prisma.InputJsonValue) ?? undefined,
        }),
      });
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "SUPPLIER_QUOTE_IMPORT",
      entityType: "SupplierQuote",
      entityId: quote.id,
      after: {
        supplierId: input.supplierId,
        lines: input.lines.length,
        flaggedLines: flaggedCount,
        thresholds: input.thresholds,
      },
    });
    return quote;
  });
}

export interface ResolveFlagInput {
  lineId: string;
  resolution: "ACCEPT" | "REQUOTE" | "SWITCH_SOURCE" | "ADJUST_PRICE";
  resolutionNote?: string | null;
  replacement?: QuoteSnapshot | null;
  thresholds: FlagThresholds;
}

/**
 * 处理一条异常行。换货源(SWITCH_SOURCE)不改写原行,
 * 而是**新建一行**并经 previousLineId 链回旧行 —— 原始报价永远可回溯(CLAUDE.md)。
 */
export async function resolveFlaggedLine(session: SessionRef, input: ResolveFlagInput) {
  const line = await prisma.supplierQuoteLine.findFirst({
    where: tenantWhere(session.tenantId, { id: input.lineId }),
  });
  if (!line) return { ok: false as const, code: "not_found", errors: [] };

  const state: FlaggedLineState = {
    lineId: line.id,
    wasFlagged: line.wasFlagged,
    flagReasons: [],
    resolution: input.resolution,
    resolutionNote: input.resolutionNote ?? null,
    replacement: input.replacement ?? null,
  };
  const check = validateResolution(state, input.thresholds);
  if (!check.ok) return { ok: false as const, code: "invalid_resolution", errors: check.errors };

  await prisma.$transaction(async (tx) => {
    await tx.supplierQuoteLine.updateMany({
      where: tenantWhere(session.tenantId, { id: input.lineId }),
      data: { resolution: input.resolution, resolutionNote: input.resolutionNote ?? null },
    });

    if (input.resolution === "SWITCH_SOURCE" && input.replacement) {
      const r = input.replacement;
      await tx.supplierQuoteLine.create({
        data: tenantData(session.tenantId, {
          supplierQuoteId: line.supplierQuoteId,
          bomLineId: line.bomLineId,
          mpn: line.mpn,
          manufacturer: line.manufacturer,
          unitPrice: r.unitPrice,
          currency: r.currency,
          moq: r.moq,
          spq: r.spq,
          leadTimeDays: r.leadTimeDays,
          sourcingMode: line.sourcingMode,
          quotedAt: new Date(r.quotedAt),
          wasFlagged: false,
          previousLineId: line.id,
        }),
      });
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "SUPPLIER_QUOTE_LINE_RESOLVE",
      entityType: "SupplierQuoteLine",
      entityId: input.lineId,
      before: { resolution: line.resolution, wasFlagged: line.wasFlagged },
      after: {
        resolution: input.resolution,
        note: input.resolutionNote ?? null,
        replacement: input.replacement ?? null,
      },
    });
  });

  return { ok: true as const, code: "ok", errors: [] };
}

/** 采购选定某行(SPEC §11:保存选择理由) */
export async function selectQuoteLine(
  session: SessionRef,
  lineId: string,
  reason: string | null,
  overrodeRecommendation: boolean,
) {
  const line = await prisma.supplierQuoteLine.findFirst({
    where: tenantWhere(session.tenantId, { id: lineId }),
    include: { supplierQuote: { select: { procurementRfqId: true } } },
  });
  if (!line) return null;

  await prisma.$transaction(async (tx) => {
    // 同一 BOM 行同时只允许一个选定
    if (line.bomLineId) {
      await tx.supplierQuoteLine.updateMany({
        where: tenantWhere(session.tenantId, { bomLineId: line.bomLineId }),
        data: { selected: false },
      });
    }
    await tx.supplierQuoteLine.updateMany({
      where: tenantWhere(session.tenantId, { id: lineId }),
      data: { selected: true, selectionReason: reason },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: overrodeRecommendation ? "SOURCING_SELECT_OVERRIDE" : "SOURCING_SELECT",
      entityType: "SupplierQuoteLine",
      entityId: lineId,
      after: { selected: true, reason, overrodeRecommendation },
    });
  });
  return line;
}

/** 反馈 PM:必须全部原始异常行都已处理(铁律 5) */
export async function submitFeedbackToPm(
  session: SessionRef,
  prfqId: string,
  note: string | null,
) {
  const prfq = await getProcurementRfq(session, prfqId);
  if (!prfq) return { ok: false as const, code: "not_found", progress: null };

  // 落库视图:结论写入时已完整校验(见 resolveFlaggedLine),此处只统计是否都已有结论
  const progress = persistedProgress(
    prfq.supplierQuotes.flatMap((q) =>
      q.lines.map((l) => ({
        lineId: l.id,
        wasFlagged: l.wasFlagged,
        resolution: l.resolution,
      })),
    ),
  );
  if (!progress.canSubmitToPm) {
    return { ok: false as const, code: "unresolved_flags", progress };
  }

  await prisma.$transaction(async (tx) => {
    await tx.procurementRFQ.updateMany({
      where: tenantWhere(session.tenantId, { id: prfqId }),
      data: { status: "FEEDBACK_READY", feedbackNote: note },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PROCUREMENT_RFQ_FEEDBACK",
      entityType: "ProcurementRFQ",
      entityId: prfqId,
      after: { status: "FEEDBACK_READY", note, progress },
    });
  });
  return { ok: true as const, code: "ok", progress };
}

/** 供应商预设基础数据维护(整合方案 3.2:MOQ/LT/多阶价格) */
export async function upsertSupplierOffer(
  session: SessionRef,
  input: {
    supplierId: string;
    mpn: string;
    manufacturer?: string | null;
    currency: string;
    moq?: number | null;
    spq?: number | null;
    leadTimeDays?: number | null;
    priceBreaks: { minQty: number; unitPrice: string }[];
  },
) {
  // R0-8:最后一道 —— 任何调用方都不得把 0/负/不可解析的价格写进报价池。
  // 路由层已用 zod 校验,这里是不变量兜底(写库前 fail closed,不静默落 0)。
  for (const pb of input.priceBreaks) {
    const check = checkUsablePrice(pb.unitPrice);
    if (!check.ok) throw new Error(`供应商报价落库被拒:${check.message}(minQty=${pb.minQty})`);
  }
  return prisma.$transaction(async (tx) => {
    const offer = await tx.supplierOffer.create({
      data: tenantData(session.tenantId, {
        provider: "OFFLINE",
        supplierId: input.supplierId,
        mpn: input.mpn,
        manufacturer: input.manufacturer ?? null,
        moq: input.moq ?? null,
        spq: input.spq ?? null,
        leadTimeDays: input.leadTimeDays ?? null,
        currency: input.currency,
      }),
    });
    for (const pb of input.priceBreaks) {
      await tx.priceBreak.create({
        data: tenantData(session.tenantId, {
          supplierOfferId: offer.id,
          minQty: pb.minQty,
          unitPrice: pb.unitPrice,
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "SUPPLIER_OFFER_UPSERT",
      entityType: "SupplierOffer",
      entityId: offer.id,
      after: { mpn: input.mpn, supplierId: input.supplierId, breaks: input.priceBreaks.length },
    });
    return offer;
  });
}

export { buildComparisonSet };
