import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  ECN_PRIORITY_LABEL,
  ECN_STATUS_LABEL,
  ECN_TYPE_LABEL,
  type EcnStatusValue,
} from "@/lib/domain/ecn";
import { ecnMetric } from "@/lib/metrics";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { formatDate } from "@/lib/format/datetime";
import { CreateEcnForm } from "./create-form";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "gray" | "blue"> = {
  DRAFT: "gray",
  REVIEW: "amber",
  CUSTOMER_CONFIRM: "amber",
  APPROVED: "blue",
  RELEASED: "green",
  CLOSED: "gray",
  VOIDED: "red",
};

/** F2:ECN 列表(ECN-Lite;完整 ECN 仍在待商务确认池) */
export default async function EcnListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; priority?: string; customerId?: string }>;
}) {
  const session = (await getSession())!;
  const { status, type, priority, customerId } = await searchParams;

  const [kpi, rows, customers] = await Promise.all([
    ecnMetric(session.tenantId),
    prisma.ecn.findMany({
      where: tenantWhere(session.tenantId, {
        ...(status ? { status: status as never } : {}),
        ...(type ? { type: type as never } : {}),
        ...(priority ? { priority: priority as never } : {}),
        ...(customerId ? { customerId } : {}),
      }),
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { changeLines: true } } },
      take: 100,
    }),
    prisma.customer.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const canCreate = session.roles.some((r) => r === "PM" || r === "ENGINEERING" || r === "MANAGEMENT");

  const kpiLink = (params: string) => `/ecn?${params}`;

  return (
    <div>
      <PageHeader path="/ecn" />
      <Banner tone="soft">
        <span>
          <b>ECN-Lite</b>:当前版本支持登记、评审(工程 → 采购 → 管理,租户可停用前两段)、
          批准、发布(快照冻结)与 BOM 关联;<b>发布不自动改 BOM</b>,
          「Apply to BOM」需显式二次确认。完整 ECN(流程引擎/签章/MES 指令)在待商务确认池。
        </span>
      </Banner>

      <div className="kpis" data-testid="ecn-kpis">
        <Link className="kpi" href={kpiLink("")}>
          <div className="kpi-num">{kpi.active}</div>
          <div className="kpi-label">Active</div>
        </Link>
        <Link className={kpi.awaitingReview > 0 ? "kpi warn" : "kpi"} href={kpiLink("status=REVIEW")} data-testid="ecn-kpi-review">
          <div className="kpi-num">{kpi.awaitingReview}</div>
          <div className="kpi-label">待评审</div>
        </Link>
        <Link className="kpi" href={kpiLink("status=CUSTOMER_CONFIRM")}>
          <div className="kpi-num">{kpi.customerConfirm}</div>
          <div className="kpi-label">待客户确认</div>
        </Link>
        <div className={kpi.overdue > 0 ? "kpi danger" : "kpi"}>
          <div className="kpi-num">{kpi.overdue}</div>
          <div className="kpi-label">已逾期</div>
        </div>
        <Link className="kpi" href={kpiLink("status=RELEASED")}>
          <div className="kpi-num">{kpi.releasedThisMonth}</div>
          <div className="kpi-label">本月发布</div>
        </Link>
      </div>

      {canCreate ? <CreateEcnForm customers={customers} /> : null}

      <Card title="ECN 列表" sub={`${rows.length} 条(最多显示 100)`} flush>
        <form style={{ display: "flex", gap: 8, padding: "10px 16px", flexWrap: "wrap" }}>
          <select name="status" defaultValue={status ?? ""} aria-label="状态筛选">
            <option value="">全部状态</option>
            {Object.entries(ECN_STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select name="type" defaultValue={type ?? ""} aria-label="类型筛选">
            <option value="">全部类型</option>
            {Object.entries(ECN_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select name="priority" defaultValue={priority ?? ""} aria-label="优先级筛选">
            <option value="">全部优先级</option>
            {Object.entries(ECN_PRIORITY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select name="customerId" defaultValue={customerId ?? ""} aria-label="客户筛选">
            <option value="">全部客户</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn" type="submit">
            筛选
          </button>
        </form>
        <div className="tbl-scroll">
          <table className="tbl" data-testid="ecn-table">
            <thead>
              <tr>
                <th>ECN No</th>
                <th>标题</th>
                <th>类型</th>
                <th>优先级</th>
                <th>状态</th>
                <th>客户</th>
                <th>变更行</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无 ECN
                  </td>
                </tr>
              ) : (
                rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/ecn/${e.id}`} data-testid={`ecn-link-${e.code}`}>
                        {e.code}
                      </Link>
                    </td>
                    <td>{e.title}</td>
                    <td className="small">{ECN_TYPE_LABEL[e.type] ?? e.type}</td>
                    <td className="small">{ECN_PRIORITY_LABEL[e.priority] ?? e.priority}</td>
                    <td>
                      <Badge tone={STATUS_TONE[e.status] ?? "gray"}>
                        {ECN_STATUS_LABEL[e.status as EcnStatusValue] ?? e.status}
                      </Badge>
                    </td>
                    <td className="small">{e.customerId ? (customerName.get(e.customerId) ?? "—") : "—"}</td>
                    <td className="num">{e._count.changeLines}</td>
                    <td className="small">{formatDate(e.updatedAt)}</td>
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
