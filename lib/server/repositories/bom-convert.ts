/**
 * 预 BOM → 正式 BOM 的转换(数据层)。
 *
 * 判定规则全在 `lib/domain/bom-purpose.ts`,这里只负责取数、落库与审计。
 *
 * 取数上的一处诚实交代:内部料号匹配要做**归一化**(大小写、连字符),
 * 而 Postgres 这边没有对应的函数索引,Prisma 也表达不了。所以这里走两条路:
 *
 * - **精确匹配**:用 `mpn IN (...)` 直接查,永远准确,不受任何上限影响;
 * - **归一化匹配**:扫描物料表(上限 `SCAN_CAP`),覆盖 `ABC-123` ↔ `abc123` 这类差异。
 *
 * 物料超过上限时归一化那一路会**不完整** —— 这时返回 `scanTruncated`,
 * 由页面明说"归一化匹配只覆盖了前 N 颗料,精确同名仍然准确",
 * 而不是让人以为"系统查过了,确实没有"。
 */
import type { Prisma } from "@prisma/client";
import {
  normalizePnKey,
  type ConvertLineInput,
  type InternalPnMatchContext,
  type MatchSummary,
  type PartRef,
} from "@/lib/domain/bom-purpose";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

/** 归一化匹配的扫描上限。超过时降级并**上报**,绝不静默截断。 */
export const SCAN_CAP = 20_000;

export interface BuildContextResult {
  ctx: InternalPnMatchContext;
  /** 物料表超过扫描上限 —— 归一化匹配不完整,必须让人知道 */
  scanTruncated: boolean;
  /** 客户料号对照表超过扫描上限 */
  mappingTruncated: boolean;
}

function addRef(map: Map<string, PartRef[]>, key: string, ref: PartRef) {
  if (!key) return;
  const list = map.get(key) ?? [];
  // 同一颗料重复出现(精确路与扫描路都命中)不算歧义
  if (list.some((r) => r.partId === ref.partId)) return;
  list.push(ref);
  map.set(key, list);
}

export async function buildMatchContext(
  tenantId: string,
  customerId: string,
  rawMpns: readonly string[],
): Promise<BuildContextResult> {
  const [exactParts, scannedParts, mappings] = await Promise.all([
    rawMpns.length
      ? prisma.part.findMany({
          where: tenantWhere(tenantId, { mpn: { in: [...new Set(rawMpns)] } }),
          select: { id: true, internalPn: true, mpn: true },
        })
      : Promise.resolve([]),
    prisma.part.findMany({
      where: tenantWhere(tenantId, { mpn: { not: null } }),
      select: { id: true, internalPn: true, mpn: true },
      take: SCAN_CAP + 1,
    }),
    prisma.customerPartMapping.findMany({
      where: tenantWhere(tenantId, { customerId, partId: { not: null } }),
      select: { customerPn: true, partId: true },
      take: SCAN_CAP + 1,
    }),
  ]);

  const scanTruncated = scannedParts.length > SCAN_CAP;
  const mappingTruncated = mappings.length > SCAN_CAP;

  const byMpn = new Map<string, PartRef[]>();
  for (const p of [...scannedParts.slice(0, SCAN_CAP), ...exactParts]) {
    addRef(byMpn, normalizePnKey(p.mpn), { partId: p.id, internalPn: p.internalPn });
  }

  const partIds = [...new Set(mappings.slice(0, SCAN_CAP).map((m) => m.partId!))];
  const mappedParts = partIds.length
    ? await prisma.part.findMany({
        where: tenantWhere(tenantId, { id: { in: partIds } }),
        select: { id: true, internalPn: true },
      })
    : [];
  const internalPnOf = new Map(mappedParts.map((p) => [p.id, p.internalPn]));

  const byCustomerPn = new Map<string, PartRef>();
  for (const m of mappings.slice(0, SCAN_CAP)) {
    const internalPn = internalPnOf.get(m.partId!);
    if (!internalPn) continue; // 对照表指向一颗已不存在的料 —— 当作没有,不猜
    const key = normalizePnKey(m.customerPn);
    if (key) byCustomerPn.set(key, { partId: m.partId!, internalPn });
  }

  return { ctx: { byCustomerPn, byMpn }, scanTruncated, mappingTruncated };
}

export interface SourceBom {
  id: string;
  name: string;
  purpose: "PRE_QUOTE" | "PRODUCTION";
  customerId: string | null;
  rfqId: string | null;
  latestVersionId: string | null;
  lines: (ConvertLineInput & {
    id: string;
    refDes: string | null;
    qty: Prisma.Decimal;
    manufacturer: string | null;
    description: string | null;
    footprint: string | null;
    packageCode: string | null;
    mpnSource: string | null;
  })[];
}

export async function loadSourceBom(tenantId: string, bomId: string): Promise<SourceBom | null> {
  const bom = await prisma.bOM.findFirst({
    where: tenantWhere(tenantId, { id: bomId }),
    select: { id: true, name: true, purpose: true, customerId: true, rfqId: true },
  });
  if (!bom) return null;

  const version = await prisma.bOMVersion.findFirst({
    where: tenantWhere(tenantId, { bomId: bom.id }),
    orderBy: { versionNo: "desc" },
    select: { id: true },
  });
  const lines = version
    ? await prisma.bOMLine.findMany({
        where: tenantWhere(tenantId, { bomVersionId: version.id }),
        orderBy: { lineNo: "asc" },
      })
    : [];

  return {
    ...bom,
    latestVersionId: version?.id ?? null,
    lines: lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      refDes: l.refDes,
      qty: l.qty,
      customerPn: l.customerPn,
      mpn: l.mpn,
      manufacturer: l.manufacturer,
      description: l.description,
      footprint: l.footprint,
      packageCode: l.packageCode,
      mpnSource: l.mpnSource,
    })),
  };
}

export interface ExecuteConvertInput {
  tenantId: string;
  userId: string;
  source: SourceBom;
  customerId: string;
  summary: MatchSummary;
  scanTruncated: boolean;
}

/** 执行转换:**新建**一份正式 BOM,源预 BOM 一个字节都不动 */
export async function executeConvert(input: ExecuteConvertInput) {
  const { tenantId, userId, source, customerId, summary } = input;
  const byLineNo = new Map(summary.results.map((r) => [r.lineNo, r]));

  return prisma.$transaction(async (tx) => {
    const bom = await tx.bOM.create({
      data: tenantData(tenantId, {
        name: `${source.name}(正式)`,
        customerId,
        rfqId: source.rfqId,
        purpose: "PRODUCTION",
        convertedFromBomId: source.id,
        convertedAt: new Date(),
        convertedById: userId,
      }),
    });
    const version = await tx.bOMVersion.create({
      data: tenantData(tenantId, {
        bomId: bom.id,
        versionNo: 1,
        note: `由预 BOM「${source.name}」转换而来;内部料号匹配 ${summary.matched}/${source.lines.length} 行${
          summary.needsManual > 0 ? `,${summary.needsManual} 行待补` : ""
        }`,
        createdById: userId,
      }),
    });
    await tx.bOMLine.createMany({
      data: source.lines.map((l) => {
        const m = byLineNo.get(l.lineNo);
        return tenantData(tenantId, {
          bomVersionId: version.id,
          lineNo: l.lineNo,
          refDes: l.refDes,
          qty: l.qty,
          customerPn: l.customerPn,
          mpn: l.mpn,
          manufacturer: l.manufacturer,
          description: l.description,
          footprint: l.footprint,
          packageCode: l.packageCode,
          mpnSource: l.mpnSource,
          internalPartId: m?.partId ?? null,
          internalPn: m?.internalPn ?? null,
          internalPnSource: m?.source ?? null,
          internalPnNote: m?.reason ?? null,
        });
      }),
    });
    await writeAudit(tx, {
      tenantId,
      userId,
      action: "BOM_CONVERT_TO_PRODUCTION",
      entityType: "BOM",
      entityId: bom.id,
      before: { sourceBomId: source.id, sourceName: source.name, purpose: source.purpose },
      after: {
        productionBomId: bom.id,
        customerId,
        lineCount: source.lines.length,
        matched: summary.matched,
        ambiguous: summary.ambiguous,
        unmatched: summary.unmatched,
        // 归一化匹配是否降级 —— 事后要能解释"为什么当时少匹配了几行"
        scanTruncated: input.scanTruncated,
      },
    });
    return { bom, version };
  });
}
