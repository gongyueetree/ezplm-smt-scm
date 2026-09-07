import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getMesTraceProvider, traceGranularityNote } from "@/lib/providers/mes";
import { formatDateTime } from "@/lib/format/datetime";
import { qualityMetric } from "@/lib/metrics";
import { prisma } from "@/lib/server/db";
import { loadPermissions } from "@/lib/server/permissions";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { QualityForm } from "./form";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  INCOMING: "来料异常",
  PROCESS: "过程异常",
  CUSTOMER_COMPLAINT: "客户投诉",
  SUPPLIER: "供应商问题",
  TRACE_INCIDENT: "追溯事件",
  OTHER: "其它",
};

const STATUS_TONE: Record<string, "red" | "amber" | "green" | "gray"> = {
  OPEN: "red",
  INVESTIGATING: "amber",
  CONTAINED: "amber",
  CLOSED: "green",
};

/**
 * E6:最小品质模块(客户 Q12)。
 *
 * 客户说质量事件由**品质**录入,而系统没有品质模块 ——
 * 这一页就是那个缺口的最小填补:能登记、能分类、能跟状态、能挂追溯。
 * **不是完整 QMS**,页面上写明,免得被当成 8D/CAPA 都有了。
 */
export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    status?: string;
    customerId?: string;
    supplierId?: string;
    severity?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const session = (await getSession())!;
  const filters = await searchParams;
  const perms = await loadPermissions(session);
  const canView = perms.has("quality.view");
  const canCreate = perms.has("quality.create");

  const where = tenantWhere(session.tenantId, {
    ...(filters.type ? { eventType: filters.type as never } : {}),
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  });

  const [incidents, snCount, customers, suppliers, kpi, trendRows] = await Promise.all([
    canView
      ? prisma.qualityIncident.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
    prisma.finishedGoodsSerial.count({ where: tenantWhere(session.tenantId) }),
    prisma.customer.findMany({ where: tenantWhere(session.tenantId), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: tenantWhere(session.tenantId), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // F6-A:KPI **必须消费 lib/metrics**(与管理看板同一查询源),本页不新写聚合
    qualityMetric(session.tenantId, new Date().toISOString()),
    // 90 天趋势(按周汇总;tenant scope 由 where 保证)
    canView
      ? prisma.qualityIncident.findMany({
          where: tenantWhere(session.tenantId, {
            createdAt: { gte: new Date(Date.now() - 90 * 86400_000) },
          }),
          select: { createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  // 周桶(13 周):简单 SVG 条形,不引第三方图表库(仓库没有,如实用轻量实现)
  const WEEK = 7 * 86400_000;
  const buckets = new Array(13).fill(0);
  const now = Date.now();
  for (const r of trendRows) {
    const idx = 12 - Math.floor((now - r.createdAt.getTime()) / WEEK);
    if (idx >= 0 && idx < 13) buckets[idx] += 1;
  }
  const maxBucket = Math.max(1, ...buckets);

  const mes = getMesTraceProvider();

  return (
    <div>
      <PageHeader path="/quality" />

      <Banner tone="soft">
        <span data-testid="quality-scope-note">
          这是<b>最小品质模块</b>:登记质量事件、分类、跟状态、与追溯挂接。
          <b>不是完整 QMS</b> —— 8D / CAPA / SPC / PPAP 均未实现,页面也不会假装有。
          <br />
          访问由 <b>quality.view / quality.create / quality.manage</b> 权限控制,
          <b>没有新增「品质」角色</b> —— 角色枚举牵连菜单、工作台与数据范围,
          为一个模块去动它得不偿失;品质专员由管理员单独授权即可。
          <br />
          {traceGranularityNote(mes.state, snCount).replace(/\*\*/g, "")}
        </span>
      </Banner>

      {canView ? (
        <>
          <div className="kpis" data-testid="quality-kpis">
            <a className={kpi.open > 0 ? "kpi danger" : "kpi"} href="/quality?status=OPEN" data-testid="quality-kpi-open">
              <div className="kpi-num">{kpi.open}</div>
              <div className="kpi-label">Open</div>
            </a>
            <a className="kpi" href="/quality?status=INVESTIGATING">
              <div className="kpi-num">{kpi.investigating}</div>
              <div className="kpi-label">调查中</div>
            </a>
            <a className="kpi" href="/quality?status=CONTAINED">
              <div className="kpi-num">{kpi.contained}</div>
              <div className="kpi-label">已围堵</div>
            </a>
            <div className="kpi">
              <div className="kpi-num">{kpi.closedThisMonth}</div>
              <div className="kpi-label">本月关闭</div>
            </div>
            <a className="kpi" href="/quality?type=CUSTOMER_COMPLAINT" data-testid="quality-kpi-complaint">
              <div className="kpi-num">{kpi.customerComplaints}</div>
              <div className="kpi-label">客户投诉</div>
            </a>
            <a className="kpi" href="/quality?type=SUPPLIER">
              <div className="kpi-num">{kpi.supplierIssues}</div>
              <div className="kpi-label">供应商问题</div>
            </a>
          </div>

          <Card title="90 天趋势(按周)" sub="事件登记数;数据仅含本租户">
            <svg viewBox="0 0 260 60" width="260" height="60" role="img" aria-label="90 天质量事件趋势" data-testid="quality-trend">
              {buckets.map((v, i) => (
                <rect
                  key={i}
                  x={i * 20 + 2}
                  y={56 - (v / maxBucket) * 50}
                  width={14}
                  height={Math.max(1, (v / maxBucket) * 50)}
                  fill={v > 0 ? "var(--brand, #00890b)" : "var(--gray-200, #e5e5e5)"}
                >
                  <title>{`${13 - i} 周前:${v} 件`}</title>
                </rect>
              ))}
            </svg>
          </Card>

          <Card title="筛选" flush>
            <form style={{ display: "flex", gap: 8, padding: "10px 16px", flexWrap: "wrap" }}>
              <select name="type" defaultValue={filters.type ?? ""} aria-label="类型筛选">
                <option value="">全部类型</option>
                {Object.entries(TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <select name="status" defaultValue={filters.status ?? ""} aria-label="状态筛选">
                <option value="">全部状态</option>
                {["OPEN", "INVESTIGATING", "CONTAINED", "CLOSED"].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <select name="customerId" defaultValue={filters.customerId ?? ""} aria-label="客户筛选">
                <option value="">全部客户</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select name="supplierId" defaultValue={filters.supplierId ?? ""} aria-label="供应商筛选">
                <option value="">全部供应商</option>
                {suppliers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input type="date" name="from" defaultValue={filters.from ?? ""} aria-label="起始日期" />
              <input type="date" name="to" defaultValue={filters.to ?? ""} aria-label="截止日期" />
              <button className="btn" type="submit">筛选</button>
            </form>
          </Card>
        </>
      ) : null}

      {!canView ? (
        <Card title="无权限">
          <p className="small muted" data-testid="quality-no-permission">
            当前账号没有 <b>quality.view</b> 权限。质量事件由品质维护 ——
            请让管理员在「系统设置 → 权限」里授予。
          </p>
        </Card>
      ) : (
        <>
          {canCreate ? (
            <Card title="登记质量事件" sub="客诉必须挂客户,供应商问题必须挂供应商">
              <QualityForm customers={customers} suppliers={suppliers} />
            </Card>
          ) : (
            <Card title="登记质量事件">
              <p className="small muted">
                当前账号可查看但<b>不可录入</b>(缺 quality.create)。
              </p>
            </Card>
          )}

          <Card title="质量事件" sub={`${incidents.length} 条 · 按创建时间倒序`} flush>
            <div className="tbl-scroll">
              <table className="tbl" data-testid="quality-table">
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>类型</th>
                    <th>标题</th>
                    <th>物料 / 批次 / SN</th>
                    <th>状态</th>
                    <th>登记时间</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                        暂无质量事件
                      </td>
                    </tr>
                  ) : (
                    incidents.map((i) => (
                      <tr key={i.id}>
                        <td className="mono small">{i.code}</td>
                        <td className="small">{TYPE_LABEL[i.eventType] ?? i.eventType}</td>
                        <td>{i.title}</td>
                        <td className="small muted">
                          {[i.mpn, i.lotId, i.sn].filter(Boolean).join(" / ") || "-"}
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[i.status] ?? "gray"}>{i.status}</Badge>
                        </td>
                        <td className="small">{formatDateTime(i.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
