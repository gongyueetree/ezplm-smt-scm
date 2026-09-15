/**
 * F7:BOM 详情页取数与批量确认。
 *
 * 复用纪律(spec 硬约束):
 * - 匹配确认走既有 `saveLineDecision`(草稿料守卫、审计、写回 MPN 都在里面),
 *   批量确认只是**同一函数的循环 + 一条批量审计**,不是第二套逻辑;
 * - 版本变更点数走既有 `compareBomVersions`,不新写 diff;
 * - 库存列读本地 InventorySnapshot(ERP 侧快照缓存)并**带 fetchedAt**,
 *   没有快照就是「待接入」,不显示 0。
 */
import { compareBomVersions } from "@/lib/domain/bom-compare";
import type { ParsedBomLine } from "@/lib/domain/bom-parse";
import { eligibleForBulkConfirm, type BomKpiLine } from "@/lib/domain/bom-detail";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { saveLineDecision } from "@/lib/server/repositories/bom-import";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface BomVersionRow {
  id: string;
  versionNo: number;
  createdById: string;
  createdAt: Date;
  note: string | null;
  lineCount: number;
  decidedCount: number;
  /** 相对上一版本的变更点数(compareBomVersions);首版或版本过多未算时为 null */
  changeCount: number | null;
}

/** 变更点数逐对全量比对的上限 —— 超过就不在列表页硬算(对比页仍可任选两版) */
const DIFF_CAP = 10;

function toParsedLine(l: {
  lineNo: number;
  refDes: string | null;
  qty: unknown;
  mpn: string | null;
  manufacturer: string | null;
  customerPn: string | null;
  description: string | null;
  footprint: string | null;
}): ParsedBomLine {
  return {
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
  };
}

export async function getBomDetail(session: SessionRef, bomId: string) {
  const bom = await prisma.bOM.findFirst({
    where: tenantWhere(session.tenantId, { id: bomId }),
    include: {
      rfq: { select: { id: true, code: true, title: true } },
      convertedFromBom: { select: { id: true, name: true } },
      convertedTo: { select: { id: true, name: true } },
    },
  });
  if (!bom) return null;

  const customer = bom.customerId
    ? await prisma.customer.findFirst({
        where: tenantWhere(session.tenantId, { id: bom.customerId }),
        select: { id: true, name: true },
      })
    : null;

  const versions = await prisma.bOMVersion.findMany({
    where: tenantWhere(session.tenantId, { bomId }),
    orderBy: { versionNo: "desc" },
    include: {
      _count: { select: { lines: true } },
    },
  });

  // 每版已确认行数(一次 groupBy,不逐版查)
  const decidedGroups = await prisma.bomLineDecision.groupBy({
    by: ["bomLineId"],
    where: tenantWhere(session.tenantId, {
      bomLine: { bomVersionId: { in: versions.map((v) => v.id) } },
    }),
  });
  const decidedLineIds = new Set(decidedGroups.map((g) => g.bomLineId));
  const lineVersionRows = decidedLineIds.size
    ? await prisma.bOMLine.findMany({
        where: tenantWhere(session.tenantId, { id: { in: [...decidedLineIds] } }),
        select: { id: true, bomVersionId: true },
      })
    : [];
  const decidedByVersion = new Map<string, number>();
  for (const row of lineVersionRows) {
    decidedByVersion.set(row.bomVersionId, (decidedByVersion.get(row.bomVersionId) ?? 0) + 1);
  }

  // 相邻版本变更点数(复用 compareBomVersions;版本多时不硬算)
  const changeByVersion = new Map<string, number>();
  if (versions.length >= 2 && versions.length <= DIFF_CAP) {
    const linesByVersion = new Map<string, ParsedBomLine[]>();
    const allLines = await prisma.bOMLine.findMany({
      where: tenantWhere(session.tenantId, { bomVersionId: { in: versions.map((v) => v.id) } }),
      orderBy: { lineNo: "asc" },
    });
    for (const l of allLines) {
      const list = linesByVersion.get(l.bomVersionId) ?? [];
      list.push(toParsedLine(l));
      linesByVersion.set(l.bomVersionId, list);
    }
    const asc = [...versions].sort((a, b) => a.versionNo - b.versionNo);
    for (let i = 1; i < asc.length; i++) {
      const { summary } = compareBomVersions(
        linesByVersion.get(asc[i - 1].id) ?? [],
        linesByVersion.get(asc[i].id) ?? [],
      );
      changeByVersion.set(
        asc[i].id,
        summary.added + summary.removed + summary.qtyChanged + summary.partChanged,
      );
    }
  }

  const versionRows: BomVersionRow[] = versions.map((v) => ({
    id: v.id,
    versionNo: v.versionNo,
    createdById: v.createdById,
    createdAt: v.createdAt,
    note: v.note,
    lineCount: v._count.lines,
    decidedCount: decidedByVersion.get(v.id) ?? 0,
    changeCount: v.versionNo === Math.min(...versions.map((x) => x.versionNo))
      ? null
      : (changeByVersion.get(v.id) ?? null),
  }));

  return { bom, customer, versions: versionRows, diffCapped: versions.length > DIFF_CAP };
}

/** 行级库存(本地 ERP 快照缓存;带 fetchedAt。没有快照 = null,页面显示「待接入」) */
export async function inventoryForParts(
  tenantId: string,
  partIds: readonly string[],
): Promise<Map<string, { qtyOnHand: number; fetchedAt: Date }>> {
  if (partIds.length === 0) return new Map();
  const rows = await prisma.inventorySnapshot.findMany({
    where: tenantWhere(tenantId, { partId: { in: [...new Set(partIds)] } }),
    select: { partId: true, qtyOnHand: true, fetchedAt: true },
  });
  const map = new Map<string, { qtyOnHand: number; fetchedAt: Date }>();
  for (const r of rows) {
    if (!r.partId) continue; // R4-4:主数据外库存行 partId 空,不参与按料聚合
    const prev = map.get(r.partId);
    // 同料多仓合计;fetchedAt 取最旧的(诚实:整行数据至少旧到这个时点)
    map.set(r.partId, {
      qtyOnHand: (prev?.qtyOnHand ?? 0) + Number(r.qtyOnHand),
      fetchedAt: prev && prev.fetchedAt < r.fetchedAt ? prev.fetchedAt : r.fetchedAt,
    });
  }
  return map;
}

/** 行级替代关系计数(既有 PartAlternate,只读) */
export async function alternateCounts(
  tenantId: string,
  partIds: readonly string[],
): Promise<Map<string, number>> {
  if (partIds.length === 0) return new Map();
  const groups = await prisma.partAlternate.groupBy({
    by: ["partId"],
    where: tenantWhere(tenantId, { partId: { in: [...new Set(partIds)] } }),
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.partId, g._count._all]));
}

/** 审批/操作历史:复用 AuditLog(BOM/版本/决定),不建流程引擎 */
export async function bomAuditTimeline(session: SessionRef, bomId: string, versionIds: string[]) {
  return prisma.auditLog.findMany({
    where: tenantWhere(session.tenantId, {
      OR: [
        { entityId: { in: [bomId, ...versionIds] } },
        // 行级决定的审计挂在 BomLineDecision 上,按 action 收
        { action: { in: ["BOM_LINE_DECISION", "BOM_BULK_CONFIRM", "BOM_CONVERT_TO_PRODUCTION"] } },
      ],
    }),
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export interface BulkConfirmResult {
  confirmed: number;
  skipped: { lineId: string; lineNo: number | null; reason: string }[];
}

/**
 * 批量确认高置信匹配。
 *
 * 服务端**重新判定资格**(阈值/未决/非相似度来源),前端勾选只是意向;
 * 每行走既有 saveLineDecision(草稿料守卫在内,被挡的行进 skipped 如实返回),
 * 最后落**一条**批量审计(条数、阈值、行号清单)。
 */
export async function bulkConfirmHighConfidence(
  session: SessionRef,
  versionId: string,
  lineIds: readonly string[],
  threshold: number,
): Promise<BulkConfirmResult | null> {
  const version = await prisma.bOMVersion.findFirst({
    where: tenantWhere(session.tenantId, { id: versionId }),
    select: { id: true, bomId: true },
  });
  if (!version) return null;

  const lines = await prisma.bOMLine.findMany({
    where: tenantWhere(session.tenantId, { bomVersionId: versionId, id: { in: [...lineIds] } }),
    include: {
      decisions: { select: { decision: true } },
      matchCandidates: { orderBy: { confidence: "desc" } },
    },
  });

  const result: BulkConfirmResult = { confirmed: 0, skipped: [] };
  const confirmedLineNos: number[] = [];

  for (const line of lines) {
    const kpiLine: BomKpiLine = {
      id: line.id,
      decision: (line.decisions[0]?.decision as BomKpiLine["decision"]) ?? null,
      candidates: line.matchCandidates.map((c) => ({
        source: c.source,
        confidence: Number(c.confidence),
      })),
    };
    const check = eligibleForBulkConfirm(kpiLine, threshold);
    if (!check.eligible) {
      result.skipped.push({ lineId: line.id, lineNo: line.lineNo, reason: check.reason ?? "不符合条件" });
      continue;
    }
    const top = line.matchCandidates[0];
    const saved = await saveLineDecision(session, line.id, {
      decision: "ACCEPT_CANDIDATE",
      candidateId: top.id,
      note: `批量确认(置信度 ${(Number(top.confidence) * 100).toFixed(0)}% ≥ 阈值 ${(threshold * 100).toFixed(0)}%)`,
    });
    if (saved && "blocked" in saved && saved.blocked) {
      result.skipped.push({ lineId: line.id, lineNo: line.lineNo, reason: saved.reason });
      continue;
    }
    if (!saved) {
      result.skipped.push({ lineId: line.id, lineNo: line.lineNo, reason: "行不存在" });
      continue;
    }
    result.confirmed += 1;
    confirmedLineNos.push(line.lineNo);
  }

  // 请求里不属于本版本的行(防串版本):如实报 skipped
  const foundIds = new Set(lines.map((l) => l.id));
  for (const id of lineIds) {
    if (!foundIds.has(id)) result.skipped.push({ lineId: id, lineNo: null, reason: "不属于该版本" });
  }

  await writeAudit(prisma, {
    tenantId: session.tenantId,
    userId: session.userId,
    action: "BOM_BULK_CONFIRM",
    entityType: "BOMVersion",
    entityId: versionId,
    after: {
      requested: lineIds.length,
      confirmed: result.confirmed,
      skipped: result.skipped.length,
      threshold,
      confirmedLineNos: confirmedLineNos.slice(0, 200),
    },
  });

  return result;
}
