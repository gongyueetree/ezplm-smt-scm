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
import { formatDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; asOf?: string }>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const now = new Date().toISOString();
  // 客户 docx:「库存总览和呆滞分析需要按照客户或者日期或者其它条件显示」
  const asOf = sp.asOf ? `${sp.asOf}T23:59:59.999Z` : now;

  const customers = await prisma.customer.findMany({
    where: tenantWhere(session.tenantId),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  /**
   * 按客户筛选:库存快照本身没有客户维度(库存是按料的),
   * 所以走"该客户的 BOM 用到哪些料"反推 —— 这是本系统能给出的**唯一诚实口径**,
   * 页面上必须写明,免得被理解成"这些库存是为该客户备的"。
   */
  let partIdFilter: string[] | null = null;
  if (sp.customerId) {
    const lines = await prisma.bOMLine.findMany({
      where: tenantWhere(session.tenantId, {
        bomVersion: { bom: { customerId: sp.customerId } },
        mpn: { not: null },
      }),
      select: { mpn: true },
      distinct: ["mpn"],
      take: 5000,
    });
    const mpns = lines.map((l) => l.mpn!).filter(Boolean);
    const hit = mpns.length
      ? await prisma.part.findMany({
          where: tenantWhere(session.tenantId, { mpn: { in: mpns } }),
          select: { id: true },
        })
      : [];
    partIdFilter = hit.map((h) => h.id);
  }

  /*
   * N-11:物料上限原为固定 take: 500 且**触顶无人知晓** —— 料超过 500 种时
   * 后面的直接看不见,而页面显示得像是全部。多取一条探测,触顶如实告知。
   * (与 A-3 追溯图边、D-3 BOM 版本同一类问题,这是第三处。)
   */
  const PART_CAP = 500;
  const partRows = await prisma.part.findMany({
    where: tenantWhere(
      session.tenantId,
      partIdFilter ? { id: { in: partIdFilter } } : {},
    ),
    orderBy: { internalPn: "asc" },
    take: PART_CAP + 1,
  });
  const partsTruncated = partRows.length > PART_CAP;
  const parts = partsTruncated ? partRows.slice(0, PART_CAP) : partRows;
  const snapshots = await prisma.inventorySnapshot.findMany({
    where: tenantWhere(session.tenantId, {
      partId: { in: parts.map((p) => p.id) },
      // 按日期看:取该时点**之前**最新的一份快照,而不是把之后的也算进来
      fetchedAt: { lte: new Date(asOf) },
    }),
    orderBy: { fetchedAt: "desc" },
  });
  const latestByPart = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) if (!latestByPart.has(s.partId)) latestByPart.set(s.partId, s);

  /*
   * N-11「显示需求」:**没有直接做成一列**。
   *
   * 「需求」在本系统里不是一个已定义的量 —— 要么按某张 BOM × 台数(哪张?几台?),
   * 要么按 excess report(系统里还没有这份数据)。随便挑一个口径算出来摆上去,
   * 使用者会当成权威数字用来下单。
   * 这里先给**口径明确、算得出**的「在途」(已下单未到货 = OpenPOLine + OPOLine 未交量),
   * 并在页面上写清「需求」待定义。
   */
  const partIds = parts.map((p) => p.id);
  const mpnList = parts.map((p) => p.mpn).filter((m): m is string => !!m);
  const [openPo, opoLines] = await Promise.all([
    partIds.length
      ? prisma.openPOLine.findMany({
          where: tenantWhere(session.tenantId, { partId: { in: partIds } }),
          select: { partId: true, qtyOpen: true },
        })
      : [],
    mpnList.length
      ? prisma.oPOLine.findMany({
          where: tenantWhere(session.tenantId, { mpn: { in: mpnList } }),
          select: { mpn: true, qtyOpen: true },
        })
      : [],
  ]);
  const inTransitByPart = new Map<string, number>();
  for (const o of openPo) {
    inTransitByPart.set(o.partId, (inTransitByPart.get(o.partId) ?? 0) + Number(o.qtyOpen));
  }
  const inTransitByMpn = new Map<string, number>();
  for (const o of opoLines) {
    if (!o.mpn) continue;
    inTransitByMpn.set(o.mpn, (inTransitByMpn.get(o.mpn) ?? 0) + Number(o.qtyOpen));
  }

  /*
   * N-11:客户要「PN」与「所有 MFG&MPN」。这里在既有行上挂三个展示用字段;
   * InventoryAgingRow 是库龄/呆滞算法的输入类型,不往里加展示字段污染领域层。
   */
  type Row = InventoryAgingRow & {
    internalPn: string;
    manufacturer: string | null;
    inTransitQty: number;
  };
  const rows: Row[] = parts.map((p) => {
    const snap = latestByPart.get(p.id);
    return {
      partId: p.id,
      internalPn: p.internalPn,
      manufacturer: p.manufacturer,
      inTransitQty:
        (inTransitByPart.get(p.id) ?? 0) + (p.mpn ? inTransitByMpn.get(p.mpn) ?? 0 : 0),
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

  const aging = deriveDcAging(rows, asOf);
  const slow = deriveSlowMoving(rows);
  const oldestFetch = snapshots.length
    ? formatDateTime(snapshots[snapshots.length - 1].fetchedAt)
    : null;

  return (
    <div>
      <PageHeader path="/inventory" />

      <Card title="筛选" sub="按客户 / 按日期查看(客户 docx 要求)">
        <form
          method="get"
          style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>客户</span>
            <select name="customerId" defaultValue={sp.customerId ?? ""}>
              <option value="">全部</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>截至日期</span>
            <input type="date" name="asOf" defaultValue={sp.asOf ?? ""} />
          </label>
          <button className="btn" type="submit">
            查看
          </button>
          <a className="btn" href="/inventory">
            重置
          </a>
        </form>
        {sp.customerId ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            ⚠ 库存快照本身<b>没有客户维度</b>(库存是按料记的)。这里的口径是
            <b>「该客户的 BOM 用到的物料」</b>,<b>不代表这些库存是为该客户备的</b> ——
            同一颗料可能同时被多个客户的 BOM 使用。
          </p>
        ) : null}
        {sp.asOf ? (
          <p className="small muted" style={{ marginTop: 6 }}>
            按日期查看取的是 <b>{sp.asOf} 之前最新的一份快照</b>;该日之后的快照不计入。
          </p>
        ) : null}
      </Card>

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

      {partsTruncated ? (
        <div className="banner warn" role="alert" data-testid="inventory-truncated">
          物料数超过 {PART_CAP} 种,本页只列出前 {PART_CAP} 种(按内部料号排序)。
          请用上方的客户筛选缩小范围 —— 否则看到的不是全部。
        </div>
      ) : null}

      <Card
        title="物料库存明细"
        sub={`${rows.length} 条(缓存)· 在途 = 已下单未到货(采购在途 + OPO 未交)`}
        flush
      >
        <p className="small muted" style={{ padding: "0 16px" }}>
          {/*
            N-11 客户还要求「显示需求」。需求在本系统里**不是一个已定义的量**:
            按哪张 BOM、几台、什么时间窗?excess report 也还没有这份数据。
            随便挑一个口径算出来摆上去,会被当成权威数字拿去下单 —— 所以先不给,
            如实说明缺什么。
          */}
          「需求」暂未提供:需先定义口径(按哪张 BOM × 几台?还是引入 excess report?)。
          在此之前不以任何假设口径估算,避免被当成可直接下单的依据。
        </p>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>PN</th>
                <th>MPN</th>
                <th>制造商</th>
                <th>DC</th>
                <th className="num">在库</th>
                <th className="num">在途</th>
                <th className="num">呆滞</th>
                <th>缓存时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无物料库存缓存
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.partId}>
                    <td className="small mono">{r.internalPn}</td>
                    <td className="small">
                      <MpnLink mpn={r.mpn} />
                    </td>
                    <td className="small">{r.manufacturer ?? <span className="muted">未知</span>}</td>
                    <td className="small">{r.dateCode ?? <span className="muted">未知</span>}</td>
                    <td className="num">{r.qtyOnHand}</td>
                    <td className="num">{r.inTransitQty}</td>
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
