import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ezplmProviderMode } from "@/lib/providers/ezplm";
import { digiKeyMode } from "@/lib/providers/digikey";
import { mouserMode } from "@/lib/providers/mouser";
import { llmStatus } from "@/lib/ai";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const dynamic = "force-dynamic";

/** 集成状态词表:只用 待确认/待授权/待联调/示例配置(CLAUDE.md 诚实 UI) */
function integrationStatus(configured: boolean, verified: string | null) {
  if (!configured) return { text: "示例配置 · 未配置凭据", tone: "amber" as const };
  if (!verified) return { text: "已配置 · 待联调", tone: "blue" as const };
  return { text: `已联调 · ${verified}`, tone: "green" as const };
}

export default async function SettingsPage() {
  const session = (await getSession())!;

  const [tenant, users, auditLogs, cronConfigured] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: session.tenantId } }),
    prisma.user.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { email: "asc" },
      include: { userRoles: { include: { role: true } } },
    }),
    prisma.auditLog.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    Promise.resolve(!!process.env.CRON_SECRET),
  ]);

  const ai = llmStatus();

  const integrations = [
    {
      name: "ezPLM",
      status: integrationStatus(ezplmProviderMode() === "http", null),
      note: "物料主数据 / 库存 / 在途(只读真源)",
    },
    {
      name: "DigiKey",
      status: integrationStatus(digiKeyMode() === "http", "2026-07-27 冒烟联调通过"),
      note: "Product Information V4",
    },
    {
      name: "Mouser",
      status: integrationStatus(mouserMode() === "http", "2026-07-27 冒烟联调通过"),
      note: "Search API v1(限流 + 日配额)",
    },
    {
      name: ai.vendor
        ? `AI 模型 · ${ai.vendor === "gemini" ? "Gemini" : "Claude"}(${ai.model})`
        : "AI 模型(未配置)",
      status: integrationStatus(ai.configured, "2026-07-28 pnpm smoke:ai 冒烟联调通过"),
      note:
        "供 报价 QuoteAgent 分类/Markup 建议 与 图片/扫描件 BOM 转写 两处使用;" +
        "未配置时降级为本地规则,页面如实标注。模型只给建议参数,金额一律由确定性函数计算。",
    },
    {
      name: "催办 Cron",
      status: cronConfigured
        ? { text: "已配置 CRON_SECRET", tone: "green" as const }
        : { text: "待授权 · 未配置 CRON_SECRET(接口拒绝运行)", tone: "amber" as const },
      note: "邮件发送仍为预览/模拟,未接入真实邮件通道",
    },
  ];

  return (
    <div>
      <PageHeader path="/settings" />
      <Banner tone="soft">
        <span>
          集成状态只使用 <b>示例配置 / 待授权 / 待联调 / 已联调</b> 四类措辞,
          不显示任何「已完成」类虚假完成态;联调状态注明验证时间与方式。
        </span>
      </Banner>

      <Card title="租户" sub={tenant?.slug}>
        <p className="small">
          {tenant?.name} · 融合字段 ezplmTenantId:
          {tenant?.ezplmTenantId ?? <span className="muted">未绑定(SSO 对接后填充)</span>}
        </p>
      </Card>

      <Card title="用户与角色" sub={`${users.length} 人`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>姓名</th>
                <th>角色</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="mono small">{u.email}</td>
                  <td className="small">{u.name}</td>
                  <td>
                    {u.userRoles.map((ur) => (
                      <Badge key={ur.id} tone="blue">
                        {ur.role.name}
                      </Badge>
                    ))}
                  </td>
                  <td>
                    <Badge tone={u.isActive ? "green" : "gray"}>
                      {u.isActive ? "启用" : "停用"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="集成状态" sub="诚实措辞,不虚报" flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>集成</th>
                <th>状态</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {integrations.map((i) => (
                <tr key={i.name}>
                  <td>
                    <b>{i.name}</b>
                  </td>
                  <td>
                    <Badge tone={i.status.tone}>{i.status.text}</Badge>
                  </td>
                  <td className="small muted">{i.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="审计日志" sub={`最近 ${auditLogs.length} 条(每个写操作必录)`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>实体</th>
                <th>操作人</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无审计记录
                  </td>
                </tr>
              ) : (
                auditLogs.map((a) => (
                  <tr key={a.id}>
                    <td className="small">
                      {a.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                    </td>
                    <td className="mono small">{a.action}</td>
                    <td className="small">
                      {a.entityType}
                      <span className="muted"> · {a.entityId.slice(0, 12)}</span>
                    </td>
                    <td className="mono small">{a.userId.slice(0, 12)}</td>
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
