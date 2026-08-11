import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { formatDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

/**
 * ERP 同步 / 集成作业日志(客户 docx:「无完整同步操作日志,无法导出同步记录」)。
 *
 * 全部由 IntegrationJob 派生。诚实口径:本系统产出的是**可导入 ERP 的模板与登记记录**,
 * 「已生成」不等于「ERP 已接收」—— 页面与导出都必须这么写。
 */
const TYPE_LABEL: Record<string, string> = {
  ERP_ORDER_EXPORT: "ERP 下单模板导出",
  ERP_ETA_WRITEBACK: "ERP 交期回写模板",
  EMAIL_SEND: "邮件发送(未接入,仅登记)",
  OPO_REMINDER: "OPO 催办",
  OTHER: "其它",
};

const STATUS_TONE: Record<string, "gray" | "blue" | "green" | "red"> = {
  PENDING: "gray",
  RUNNING: "blue",
  SUCCEEDED: "green",
  FAILED: "red",
};

export default async function SyncLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;

  const where: Record<string, unknown> = {};
  if (sp.type && TYPE_LABEL[sp.type]) where.type = sp.type;
  if (sp.status && STATUS_TONE[sp.status]) where.status = sp.status;
  if (sp.from || sp.to) {
    where.createdAt = {
      ...(sp.from ? { gte: new Date(sp.from) } : {}),
      ...(sp.to ? { lte: new Date(sp.to) } : {}),
    };
  }

  const jobs = await prisma.integrationJob.findMany({
    where: tenantWhere(session.tenantId, where),
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const q = new URLSearchParams();
  for (const k of ["type", "status", "from", "to"]) if (sp[k]) q.set(k, sp[k]!);

  return (
    <div>
      <PageHeader path="/settings/sync-log" />
      <Banner tone="soft">
        <span>
          本日志记录本系统与 ERP 之间的<b>集成作业</b>:模板导出、交期回写模板、催办等。
          <b>「已生成」不等于「ERP 已接收」</b> —— 本系统不直连 ERP 写入,
          产出的是可导入模板与登记记录,实际入账以 ERP 侧为准。
        </span>
      </Banner>

      <Card title="筛选" sub="类型 / 状态 / 时间">
        <form
          method="get"
          style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>类型</span>
            <select name="type" defaultValue={sp.type ?? ""}>
              <option value="">全部</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>状态</span>
            <select name="status" defaultValue={sp.status ?? ""}>
              <option value="">全部</option>
              {Object.keys(STATUS_TONE).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>起</span>
            <input type="date" name="from" defaultValue={sp.from ?? ""} />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>止</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} />
          </label>
          <button className="btn" type="submit">
            筛选
          </button>
          <Link className="btn" href="/settings/sync-log">
            重置
          </Link>
          <a className="btn" href={`/api/integration/log/export?${q.toString()}`}>
            导出同步记录
          </a>
        </form>
      </Card>

      <Card title="同步日志" sub={`${jobs.length} 条(近 300)`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>状态</th>
                <th className="num">重试</th>
                <th>幂等键</th>
                <th>载荷 / 错误</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无集成作业记录
                  </td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="small">
                      {formatDateTime(j.createdAt)}
                    </td>
                    <td className="small">{TYPE_LABEL[j.type] ?? j.type}</td>
                    <td>
                      <Badge tone={STATUS_TONE[j.status] ?? "gray"}>{j.status}</Badge>
                    </td>
                    <td className="num">{j.attempts}</td>
                    <td className="small mono">{j.idempotencyKey ?? "—"}</td>
                    <td className="small muted">
                      {j.lastError ?? JSON.stringify(j.payload).slice(0, 120)}
                    </td>
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
