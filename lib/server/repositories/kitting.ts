/**
 * 齐料/缺料取数(SPEC /kitting、/shortage)。
 * 库存与在途来自 ezPLM 只读缓存;**缓存缺失时返回 null 而非 0**,
 * 由领域层判为「数据未知」,不掩盖风险。
 */
import { calculateKitting, type KittingLineInput, type KittingOptions } from "@/lib/domain/kitting";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export async function buildKittingReport(
  tenantId: string,
  bomVersionId: string,
  options: KittingOptions,
) {
  const version = await prisma.bOMVersion.findFirst({
    where: tenantWhere(tenantId, { id: bomVersionId }),
    include: { bom: { select: { name: true } } },
  });
  if (!version) return null;

  const lines = await prisma.bOMLine.findMany({
    where: tenantWhere(tenantId, { bomVersionId }),
    orderBy: { lineNo: "asc" },
  });

  const mpns = [...new Set(lines.map((l) => l.mpn).filter((m): m is string => !!m))];
  const parts = mpns.length
    ? await prisma.part.findMany({
        where: tenantWhere(tenantId, { mpn: { in: mpns } }),
        select: { id: true, mpn: true, internalPn: true },
      })
    : [];
  const partIdByMpn = new Map(parts.map((p) => [p.mpn ?? "", p.id]));
  // S-5:客户要求缺料表显示 PN(内部料号)—— 主数据里没有这颗料时为 null,不编造
  const internalPnByMpn = new Map(parts.map((p) => [p.mpn ?? "", p.internalPn]));

  const [snapshots, openPo, opoLines] = await Promise.all([
    parts.length
      ? prisma.inventorySnapshot.findMany({
          where: tenantWhere(tenantId, { partId: { in: parts.map((p) => p.id) } }),
          orderBy: { fetchedAt: "desc" },
        })
      : [],
    parts.length
      ? prisma.openPOLine.findMany({
          where: tenantWhere(tenantId, { partId: { in: parts.map((p) => p.id) } }),
        })
      : [],
    // OPO 未交量同样计入在途(采购已下单但未到货)
    mpns.length
      ? prisma.oPOLine.findMany({ where: tenantWhere(tenantId, { mpn: { in: mpns } }) })
      : [],
  ]);

  const latestSnapByPart = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (s.partId && !latestSnapByPart.has(s.partId)) latestSnapByPart.set(s.partId, s);
  }

  const input: KittingLineInput[] = lines.map((l) => {
    const partId = l.mpn ? partIdByMpn.get(l.mpn) : undefined;
    const snap = partId ? latestSnapByPart.get(partId) : undefined;

    const poRows = partId ? openPo.filter((o) => o.partId === partId) : [];
    const opoRows = l.mpn ? opoLines.filter((o) => o.mpn === l.mpn) : [];
    const hasTransitSource = poRows.length > 0 || opoRows.length > 0;

    const inTransitQty = hasTransitSource
      ? poRows.reduce((s, o) => s + Number(o.qtyOpen), 0) +
        opoRows.reduce((s, o) => s + Number(o.qtyOpen), 0)
      : 0;

    const etas = [
      ...poRows.map((o) => o.eta?.toISOString() ?? null),
      ...opoRows.map((o) => o.promiseDate?.toISOString() ?? null),
    ].filter((e): e is string => !!e);

    return {
      lineNo: l.lineNo,
      refDes: l.refDes,
      mpn: l.mpn,
      internalPn: l.mpn ? internalPnByMpn.get(l.mpn) ?? null : null,
      manufacturer: l.manufacturer,
      qtyPerBoard: Number(l.qty),
      // 主数据里没有这颗料 → 库存未知(不是 0)
      stockQty: partId ? (snap ? Number(snap.qtyOnHand) : 0) : null,
      inTransitQty,
      // 取最早可用日期
      eta: etas.length ? etas.reduce((min, cur) => (Date.parse(cur) < Date.parse(min) ? cur : min)) : null,
    };
  });

  return {
    version,
    report: calculateKitting(input, options),
  };
}
