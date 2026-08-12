import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getMesTraceProvider, traceGranularityNote } from "@/lib/providers/mes";
import { formatDateTime } from "@/lib/format/datetime";
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
export default async function QualityPage() {
  const session = (await getSession())!;
  const perms = await loadPermissions(session);
  const canView = perms.has("quality.view");
  const canCreate = perms.has("quality.create");

  const [incidents, snCount, customers, suppliers] = await Promise.all([
    canView
      ? prisma.qualityIncident.findMany({
          where: tenantWhere(session.tenantId),
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
    prisma.finishedGoodsSerial.count({ where: tenantWhere(session.tenantId) }),
    prisma.customer.findMany({ where: tenantWhere(session.tenantId), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: tenantWhere(session.tenantId), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

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
