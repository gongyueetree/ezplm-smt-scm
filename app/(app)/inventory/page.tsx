import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  deriveDcAging,
  deriveSlowMoving,
  type InventoryAgingRow,
} from "@/lib/domain/management-kpi";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { MpnLink } from "@/components/ui/mpn-link";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = (await getSession())!;
  const now = new Date().toISOString();

  const parts = await prisma.part.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { internalPn: "asc" },
    take: 500,
  });
  const snapshots = await prisma.inventorySnapshot.findMany({
    where: tenantWhere(session.tenantId, { partId: { in: parts.map((p) => p.id) } }),
    orderBy: { fetchedAt: "desc" },
  });
  const latestByPart = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) if (!latestByPart.has(s.partId)) latestByPart.set(s.partId, s);

  const rows: InventoryAgingRow[] = parts.map((p) => {
    const snap = latestByPart.get(p.id);
    return {
      partId: p.id,
      mpn: p.mpn,
      qtyOnHand: snap ? Number(snap.qtyOnHand) : 0,
      qtySlowMoving:
        snap?.qtySlowMoving === null || snap?.qtySlowMoving === undefined
          ? null
          : Number(snap.qtySlowMoving),
      dateCode: p.dateCode,
      fetchedAt: snap?.fetchedAt.toISOString() ?? now,
    };
  });

  const aging = deriveDcAging(rows, now);
  const slow = deriveSlowMoving(rows);
  const oldestFetch = snapshots.length
    ? snapshots[snapshots.length - 1].fetchedAt.toISOString().slice(0, 16).replace("T", " ")
    : null;

  return (
    <div>
      <PageHeader path="/inventory" />
      <Banner tone="soft">
        <span>
          库存与呆滞数据来自 <b>ezPLM 只读缓存</b>,显示的是<b>缓存时点</b>的数据
          {oldestFetch ? `(最早缓存时间 ${oldestFetch})` : "(尚无库存快照)"},不代表实时库存。
          DC Aging 分桶阈值(6/12/24 月)为<b>示例口径,待业务确认</b>。
        </span>
      </Banner>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">物料数</div>
          <div className="kpi-value">{slow.totalParts}</div>
        </div>
        <div className="kpi warn">
          <div className="kpi-label">呆滞物料</div>
          <div className="kpi-value">{slow.slowMovingParts}</div>
          <div className="kpi-foot">呆滞数量 {slow.slowMovingQty}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">呆滞数据未知</div>
          <div className="kpi-value">{slow.unknownParts}</div>
          <div className="kpi-foot">既不算呆滞也不算正常</div>
        </div>
      </div>

      <Card title="DC Aging 分布" sub="按日期码推算的库龄" flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>库龄区间</th>
                <th className="num">物料数</th>
                <th className="num">数量</th>
              </tr>
            </thead>
            <tbody>
              {aging.buckets.map((b) => (
                <tr key={b.label} className={b.minMonths >= 24 && b.count > 0 ? "row-danger" : undefined}>
                  <td>{b.label}</td>
                  <td className="num">{b.count}</td>
                  <td className="num">{b.qty}</td>
                </tr>
              ))}
              <tr className={aging.unknownDateCode.count > 0 ? "row-warn" : undefined}>
                <td>
                  DC 未知 <Badge tone="amber">不并入任何区间</Badge>
                </td>
                <td className="num">{aging.unknownDateCode.count}</td>
                <td className="num">{aging.unknownDateCode.qty}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="物料库存明细" sub={`${rows.length} 条(缓存)`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>MPN</th>
                <th>DC</th>
                <th className="num">在库</th>
                <th className="num">呆滞</th>
                <th>缓存时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无物料库存缓存
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.partId}>
                    <td className="small">
                      <MpnLink mpn={r.mpn} />
                    </td>
                    <td className="small">{r.dateCode ?? <span className="muted">未知</span>}</td>
                    <td className="num">{r.qtyOnHand}</td>
                    <td className="num">
                      {r.qtySlowMoving === null ? <span className="muted">未知</span> : r.qtySlowMoving}
                    </td>
                    <td className="small">{r.fetchedAt.slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
