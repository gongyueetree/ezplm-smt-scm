/**
 * BOM 导入作业(SPEC §6 + §15)。
 *
 * 执行模型:**拉取式分批**。Vercel Serverless 没有常驻后台进程,
 * 因此每次轮询 / SSE tick 处理一批(10–20 个唯一 MPN)后立即返回进度,
 * 由前端持续拉取直至完成 —— 既满足"禁止单请求处理整张 BOM",
 * 又不依赖任何后台 worker,Docker 私有化部署同样适用。
 */
import type { Prisma } from "@prisma/client";
import { matchBomLines, type MatchContext, type MatchResult } from "@/lib/domain/bom-match";
import { countUniqueMpns, type ParsedBomLine } from "@/lib/domain/bom-parse";
import { computeProgress, nextBatchSlice, shouldUseImportJob } from "@/lib/domain/import-batching";
import { validateBomLines, type ValidationReport } from "@/lib/domain/bom-validate";
import { getEzplmPartsProvider } from "@/lib/providers/ezplm";
import { getDigiKeyProvider } from "@/lib/providers/digikey";
import { getMouserProvider } from "@/lib/providers/mouser";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { SessionRef } from "./rfq";

export interface CreateImportJobInput {
  rfqId?: string | null;
  bomName: string;
  fileKeys: string[];
  lines: ParsedBomLine[];
  /** 幂等键:同一文件重复提交不产生第二个作业 */
  idempotencyKey: string;
  columnMapping?: unknown;
}

/**
 * 用本地物料主数据做 EOL / 封装校验(SPEC §6)。
 * 主数据缺该 MPN 时不产生告警 —— 缺数据不等于有问题,交后续匹配与人工确认处理。
 */
async function validateWithMasterData(
  tenantId: string,
  lines: ParsedBomLine[],
): Promise<ValidationReport> {
  const key = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const mpns = [...new Set(lines.map((l) => l.mpn).filter((m): m is string => !!m))];
  const parts =
    mpns.length === 0
      ? []
      : await prisma.part.findMany({
          where: tenantWhere(tenantId, { mpn: { in: mpns } }),
          select: { mpn: true, lifecycle: true, footprint: true },
        });
  const byMpn = new Map(parts.map((p) => [key(p.mpn), p]));

  return validateBomLines(lines, {
    lifecycleOf: (mpn) => byMpn.get(key(mpn))?.lifecycle,
    footprintOf: (mpn) => byMpn.get(key(mpn))?.footprint ?? undefined,
  });
}

export interface ImportJobView {
  id: string;
  status: string;
  bomId: string | null;
  totalLines: number;
  processedLines: number;
  batchSize: number;
  error: string | null;
  usesBatching: boolean;
}

/** 创建导入作业 + BOM/版本/行(行一次性落库,匹配才分批) */
export async function createImportJob(
  session: SessionRef,
  input: CreateImportJobInput,
): Promise<{ job: ImportJobView; validation: ValidationReport; bomVersionId: string }> {
  const existing = await prisma.bOMImportJob.findFirst({
    where: tenantWhere(session.tenantId, { idempotencyKey: input.idempotencyKey }),
  });
  if (existing) {
    const v = await prisma.bOMVersion.findFirst({
      where: tenantWhere(session.tenantId, { bomId: existing.bomId ?? "" }),
      orderBy: { versionNo: "desc" },
    });
    return {
      job: toView(existing),
      validation: await validateWithMasterData(session.tenantId, input.lines),
      bomVersionId: v?.id ?? "",
    };
  }

  const validation = await validateWithMasterData(session.tenantId, input.lines);
  const uniqueMpns = countUniqueMpns(input.lines);

  const result = await prisma.$transaction(async (tx) => {
    const bom = await tx.bOM.create({
      data: tenantData(session.tenantId, {
        rfqId: input.rfqId ?? null,
        name: input.bomName,
      }),
    });
    const version = await tx.bOMVersion.create({
      data: tenantData(session.tenantId, {
        bomId: bom.id,
        versionNo: 1,
        sourceFileKey: input.fileKeys[0] ?? null,
        createdById: session.userId,
      }),
    });
    await tx.bOMLine.createMany({
      data: input.lines.map((l) =>
        tenantData(session.tenantId, {
          bomVersionId: version.id,
          lineNo: l.lineNo,
          refDes: l.refDes,
          qty: l.qty ?? 0,
          customerPn: l.customerPn,
          mpn: l.mpn,
          manufacturer: l.manufacturer,
          description: l.description,
          footprint: l.footprint,
          packageCode: l.packageCode ?? null,
          mpnSource: l.mpnSource ?? null,
          dupRefDesFlag: validation.issues.some(
            (i) => i.code === "duplicate_refdes" && i.lineNos.includes(l.lineNo),
          ),
          eolFlag: validation.issues.some(
            (i) => i.code === "eol_part" && i.lineNos.includes(l.lineNo),
          ),
          footprintMismatch: validation.issues.some(
            (i) => i.code === "footprint_mismatch" && i.lineNos.includes(l.lineNo),
          ),
        }),
      ),
    });
    const job = await tx.bOMImportJob.create({
      data: tenantData(session.tenantId, {
        bomId: bom.id,
        rfqId: input.rfqId ?? null,
        status: "PENDING",
        idempotencyKey: input.idempotencyKey,
        fileKeys: input.fileKeys as Prisma.InputJsonValue,
        totalLines: input.lines.length,
        processedLines: 0,
        columnMapping: (input.columnMapping ?? null) as Prisma.InputJsonValue,
        createdById: session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "BOM_IMPORT_CREATE",
      entityType: "BOMImportJob",
      entityId: job.id,
      after: {
        bomId: bom.id,
        lines: input.lines.length,
        uniqueMpns,
        usesBatching: shouldUseImportJob(uniqueMpns),
        errorCount: validation.errorCount,
      },
    });
    return { job, versionId: version.id };
  });

  return {
    job: { ...toView(result.job), usesBatching: shouldUseImportJob(uniqueMpns) },
    validation,
    bomVersionId: result.versionId,
  };
}

function toView(job: {
  id: string;
  status: string;
  bomId: string | null;
  totalLines: number;
  processedLines: number;
  batchSize: number;
  error: string | null;
}): ImportJobView {
  return {
    id: job.id,
    status: job.status,
    bomId: job.bomId,
    totalLines: job.totalLines,
    processedLines: job.processedLines,
    batchSize: job.batchSize,
    error: job.error,
    usesBatching: job.totalLines > 0,
  };
}

/** 构造匹配上下文:本地主数据 + 三方 Provider(业务代码不感知 Mock/Http) */
async function buildMatchContext(tenantId: string): Promise<MatchContext> {
  const [parts, mappings] = await Promise.all([
    prisma.part.findMany({ where: tenantWhere(tenantId), take: 5000 }),
    prisma.customerPartMapping.findMany({ where: tenantWhere(tenantId), take: 5000 }),
  ]);

  const norm = (v: string | null) => (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const refs = parts.map((p) => ({
    partId: p.id,
    internalPn: p.internalPn,
    mpn: p.mpn,
    manufacturer: p.manufacturer,
    footprint: p.footprint,
    lifecycle: p.lifecycle,
    description: p.description,
    stockQty: null,
    slowMovingQty: null,
    opoQty: null,
    eta: null,
    dataUpdatedAt: p.syncedAt?.toISOString() ?? null,
  }));

  const byMpn = new Map<string, typeof refs>();
  for (const r of refs) {
    const k = norm(r.mpn);
    if (!k) continue;
    byMpn.set(k, [...(byMpn.get(k) ?? []), r]);
  }

  return {
    customerMappings: new Map(
      mappings.map((m) => [
        norm(m.customerPn),
        {
          customerPn: m.customerPn,
          internalPn: null,
          mpn: m.mpn,
          manufacturer: m.manufacturer,
        },
      ]),
    ),
    byInternalPn: new Map(refs.map((r) => [norm(r.internalPn), r])),
    byMpn,
    allParts: refs,
    ezplm: getEzplmPartsProvider(),
    distributors: [getDigiKeyProvider(), getMouserProvider()],
  };
}

export interface BatchOutcome {
  job: ImportJobView;
  progress: ReturnType<typeof computeProgress>;
  /** 本批产生的降级信息(三方不可用),诚实上报不隐藏 */
  degraded: MatchResult["degraded"];
}

/**
 * 处理下一批(拉取式)。每次调用只处理一批,已完成则原样返回。
 * 返回的 degraded 由 UI 展示"API 失败时的降级信息"(SPEC §17 第 9 项)。
 */
export async function processNextBatch(
  session: SessionRef,
  jobId: string,
): Promise<BatchOutcome | null> {
  const job = await prisma.bOMImportJob.findFirst({
    where: tenantWhere(session.tenantId, { id: jobId }),
  });
  if (!job) return null;

  const slice = nextBatchSlice(job.totalLines, job.processedLines, job.batchSize);
  if (!slice) {
    if (job.status !== "SUCCEEDED") {
      await prisma.bOMImportJob.updateMany({
        where: tenantWhere(session.tenantId, { id: jobId }),
        data: { status: "SUCCEEDED" },
      });
    }
    return {
      job: { ...toView(job), status: "SUCCEEDED" },
      progress: computeProgress(job.totalLines, job.processedLines),
      degraded: [],
    };
  }

  const version = await prisma.bOMVersion.findFirst({
    where: tenantWhere(session.tenantId, { bomId: job.bomId ?? "" }),
    orderBy: { versionNo: "desc" },
  });
  if (!version) return null;

  const lines = await prisma.bOMLine.findMany({
    where: tenantWhere(session.tenantId, { bomVersionId: version.id }),
    orderBy: { lineNo: "asc" },
    skip: slice.start,
    take: slice.end - slice.start,
  });

  const parsed: ParsedBomLine[] = lines.map((l) => ({
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

  const ctx = await buildMatchContext(session.tenantId);
  const results = await matchBomLines(parsed, ctx);
  const degraded = results.flatMap((r) => r.degraded);

  const lineIdByNo = new Map(lines.map((l) => [l.lineNo, l.id]));
  await prisma.$transaction(async (tx) => {
    for (const r of results) {
      const bomLineId = lineIdByNo.get(r.lineNo);
      if (!bomLineId) continue;
      // 重跑同一批时先清旧候选,避免重复堆积(候选可重算,人工决定不动)
      await tx.bomMatchCandidate.deleteMany({
        where: tenantWhere(session.tenantId, { bomLineId }),
      });
      if (r.candidates.length === 0) continue;
      await tx.bomMatchCandidate.createMany({
        data: r.candidates.map((c) =>
          tenantData(session.tenantId, {
            bomLineId,
            source: c.source,
            confidence: c.confidence,
            partId: c.partId,
            mpn: c.mpn,
            manufacturer: c.manufacturer,
            footprint: c.footprint,
            lifecycle: c.lifecycle ?? undefined,
            stockQty: c.stockQty ?? undefined,
            slowMovingQty: c.slowMovingQty ?? undefined,
            opoQty: c.opoQty ?? undefined,
            eta: c.eta ? new Date(c.eta) : undefined,
            price: c.price ?? undefined,
            currency: c.currency,
            alternates: (c.alternates ?? undefined) as Prisma.InputJsonValue | undefined,
            dataUpdatedAt: c.dataUpdatedAt ? new Date(c.dataUpdatedAt) : undefined,
          }),
        ),
      });
    }
    await tx.bOMImportJob.updateMany({
      where: tenantWhere(session.tenantId, { id: jobId }),
      data: {
        processedLines: slice.end,
        status: slice.end >= job.totalLines ? "SUCCEEDED" : "RUNNING",
      },
    });
  });

  const progress = computeProgress(job.totalLines, slice.end);
  return {
    job: { ...toView(job), processedLines: slice.end, status: progress.done ? "SUCCEEDED" : "RUNNING" },
    progress,
    degraded,
  };
}

/** BOM 行 + 候选 + 已有人工决定(供确认页渲染) */
export async function getBomVersionDetail(session: SessionRef, bomVersionId: string) {
  const version = await prisma.bOMVersion.findFirst({
    where: tenantWhere(session.tenantId, { id: bomVersionId }),
    include: { bom: true },
  });
  if (!version) return null;

  const lines = await prisma.bOMLine.findMany({
    where: tenantWhere(session.tenantId, { bomVersionId }),
    orderBy: { lineNo: "asc" },
    include: { matchCandidates: { orderBy: { confidence: "desc" } }, decisions: true },
  });
  return { version, lines };
}

/** 人工确认(SPEC §6 第 8 步:正式匹配必须人工确认) */
export async function saveLineDecision(
  session: SessionRef,
  bomLineId: string,
  input: { candidateId?: string | null; partId?: string | null; decision: "ACCEPT_CANDIDATE" | "MANUAL_ASSIGN" | "NO_MATCH"; note?: string | null },
) {
  const line = await prisma.bOMLine.findFirst({
    where: tenantWhere(session.tenantId, { id: bomLineId }),
    select: { id: true },
  });
  if (!line) return null;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.bomLineDecision.findFirst({
      where: tenantWhere(session.tenantId, { bomLineId }),
    });
    const data = {
      candidateId: input.candidateId ?? null,
      partId: input.partId ?? null,
      decision: input.decision,
      note: input.note ?? null,
      decidedById: session.userId,
      decidedAt: new Date(),
    };
    const saved = existing
      ? (await tx.bomLineDecision.updateMany({
          where: tenantWhere(session.tenantId, { id: existing.id }),
          data,
        }),
        await tx.bomLineDecision.findFirst({
          where: tenantWhere(session.tenantId, { id: existing.id }),
        }))
      : await tx.bomLineDecision.create({
          data: tenantData(session.tenantId, { bomLineId, ...data }),
        });

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "BOM_LINE_DECISION",
      entityType: "BomLineDecision",
      entityId: saved?.id ?? bomLineId,
      before: existing ? { decision: existing.decision, candidateId: existing.candidateId } : undefined,
      after: { decision: input.decision, candidateId: input.candidateId ?? null },
    });
    return saved;
  });
}
