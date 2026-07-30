import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PO_STATUS_LABELS, PO_STATUSES, type PoStatusValue } from "@/lib/domain/po-status";
import { listPurchaseOrders } from "@/lib/server/repositories/purchase-order";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { CreatePoForm } from "./create-form";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<PoStatusValue, "gray" | "blue" | "amber" | "green" | "red"> = {
  DRAFT: "gray",
  PENDING_PRICE_REVIEW: "amber",
  PENDING_APPROVAL: "amber",
  APPROVED: "green",
  EXPORTED: "blue",
  REJECTED: "red",
  CANCELLED: "gray",
};

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const status = PO_STATUSES.includes(sp.status as PoStatusValue)
    ? (sp.status as PoStatusValue)
    : null;

  const [orders, suppliers, policy] = await Promise.all([
    listPurchaseOrders(session, {
      status,
      supplierId: sp.supplierId ?? null,
      from: sp.from ?? null,
      to: sp.to ?? null,
    }),
    prisma.supplier.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.procurementPolicy.findFirst({ where: tenantWhere(session.tenantId) }),
  ]);

  const canCreate = session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT");
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  // KPI 全部由行级派生,不落冗余计数(与 OPO 同一条纪律)
  const kpi = {
    total: orders.length,
    pending: orders.filter(
      (o) => o.status === "PENDING_PRICE_REVIEW" || o.status === "PENDING_APPROVAL",
    ).length,
    unresolved: orders.reduce((a, o) => a + o.unresolvedLines, 0),
    awaitingErp: orders.filter((o) => o.status === "APPROVED").length,
  };

  return (
    <div>
      <PageHeader path="/procurement/orders" />

      <Banner tone="soft">
        <span>
          本系统是<b>采购订单流程</b>的唯一真源;<b>ERP 才是下单执行的真源</b>。
          因此这里没有「已下单」状态 —— 审批通过后只到「已审批 · 待 ERP 录入」,
          导出模板后为「已导出 ERP 模板」,<b>导出不代表 ERP 已接单</b>。
          价格复核的历史价对比只取<b>已批准/已导出</b>单据的成交价;
          无同料历史成交价时如实标「首次采购,不可比」,<b>不显示为价格正常</b>。
          {policy?.confirmedByBusiness ? null : (
            <>
              {" "}
              当前价格/交期阈值与涨幅告警线(缺省 10%)<b>口径未经业务确认</b>,
              属演示阈值、非正式风控。
            </>
          )}
        </span>
      </Banner>

      <div className="kpi-grid">
        <Link className="kpi" href="/procurement/orders">
          <div className="kpi-label">采购订单</div>
          <div className="kpi-value">{kpi.total}</div>
          <div className="kpi-foot">近 200 条</div>
        </Link>
        <Link
          className={kpi.pending > 0 ? "kpi warn" : "kpi"}
          href="/procurement/orders?status=PENDING_PRICE_REVIEW"
        >
          <div className="kpi-label">待复核 / 待审批</div>
          <div className="kpi-value">{kpi.pending}</div>
          <div className="kpi-foot">点击下钻至待价格复核</div>
        </Link>
        <Link
          className={kpi.unresolved > 0 ? "kpi danger" : "kpi"}
          href="/procurement/orders?status=DRAFT"
        >
          <div className="kpi-label">未处理异常行</div>
          <div className="kpi-value">{kpi.unresolved}</div>
          <div className="kpi-foot">按原始异常集合计,不按当前是否仍超线</div>
        </Link>
        <Link className="kpi" href="/procurement/orders?status=APPROVED">
          <div className="kpi-label">待 ERP 录入</div>
          <div className="kpi-value">{kpi.awaitingErp}</div>
          <div className="kpi-foot">已审批未导出模板</div>
        </Link>
      </div>

      <Card title="筛选" sub="状态 / 供应商 / 时间可组合">
        <form
          method="get"
          style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>状态</span>
            <select name="status" defaultValue={status ?? ""}>
              <option value="">全部</option>
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PO_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>供应商</span>
            <select name="supplierId" defaultValue={sp.supplierId ?? ""}>
              <option value="">全部</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>创建起</span>
            <input type="date" name="from" defaultValue={sp.from ?? ""} />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>创建止</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} />
          </label>
          <button className="btn" type="submit">
            筛选
          </button>
          <Link className="btn" href="/procurement/orders">
            重置
          </Link>
        </form>
      </Card>

      {canCreate ? <CreatePoForm suppliers={suppliers} /> : null}

      <Card title="采购订单台账" sub={`${orders.length} 张 · 金额与异常数全部由行级派生`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>PO 号</th>
                <th>供应商</th>
                <th>状态</th>
                <th className="num">行数</th>
                <th className="num">金额</th>
                <th className="num">异常 / 未处理</th>
                <th>ERP 模板</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="muted small"
                    style={{ textAlign: "center", padding: 24 }}
                  >
                    暂无采购订单
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link className="mono" href={`/procurement/orders/${o.id}`}>
                        {o.poNo}
                      </Link>
                    </td>
                    <td className="small">{supplierName.get(o.supplierId) ?? o.supplierId}</td>
                    <td>
                      <Badge tone={STATUS_TONE[o.status]}>{PO_STATUS_LABELS[o.status]}</Badge>
                    </td>
                    <td className="num">{o.lineCount}</td>
                    <td className="num">
                      {o.currency} {o.amount}
                      {o.mixedCurrency ? (
                        <div className="small" style={{ color: "var(--danger)" }}>
                          含异币种行,未并入合计
                        </div>
                      ) : null}
                    </td>
                    <td className="num">
                      {o.flaggedLines} / <b>{o.unresolvedLines}</b>
                    </td>
                    <td className="small muted">
                      {o.erpExportedAt ? `${o.erpExportedAt.slice(0, 10)} 已导出` : "—"}
                    </td>
                    <td className="small muted">{o.createdAt.slice(0, 10)}</td>
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
