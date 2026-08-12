import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { getMailProvider } from "@/lib/server/mail";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { MailVerify } from "./verify";

export const dynamic = "force-dynamic";

/**
 * E7:邮件通道设置(客户 Q3)。
 *
 * 客户确认走公司 SMTP,但参数尚未提供(O4)。
 * 这一页的作用是把状态说清楚 —— **待客户提供**,而不是"功能没做"。
 */
export default async function MailSettingsPage() {
  const session = (await getSession())!;
  const provider = getMailProvider();

  const counts = await prisma.outboundMessage.groupBy({
    by: ["state"],
    where: tenantWhere(session.tenantId),
    _count: { _all: true },
  });
  const byState = Object.fromEntries(counts.map((c) => [c.state, c._count._all]));

  return (
    <div>
      <BackLink href="/settings" label="系统设置" />
      <div className="page-head">
        <div>
          <h1 className="page-title">邮件通道</h1>
          <p className="page-desc">公司 SMTP · 发送与已读回执的状态口径</p>
        </div>
        <div className="page-actions">
          <span data-testid="mail-status-badge">
            <Badge tone={provider.configured ? "green" : "amber"}>
              {provider.configured ? "参数已配置" : "待客户提供参数"}
            </Badge>
          </span>
        </div>
      </div>

      <Banner tone={provider.configured ? "soft" : "warn"}>
        <span data-testid="mail-status-note">
          {provider.configured ? (
            <>
              SMTP 参数齐全。<b>是否真的能发,以下方「连接自检」为准</b> ——
              参数写对了不等于连得上。
            </>
          ) : (
            <>
              <b>SMTP 参数未齐,当前状态:WAITING_FOR_CREDENTIALS</b>。
              缺少:<b>{provider.config.missing.join("、")}</b>。
              在参数到位之前,所有邮件停在<b>「草稿 · 未发送」</b> ——
              系统<b>不会假装已经发出去</b>。
            </>
          )}
          <br />
          <b>关于已读回执</b>(客户 Q3 选的就是它):已读回执依赖<b>收件方邮件客户端</b>配合,
          Outlook / Gmail 默认会询问用户或直接拒绝,<b>拿不到是常态</b>。
          因此系统把「已请求回执 / 已收到回执 / 追踪像素被加载」<b>三种状态分开记</b>,
          并且<b>绝不把「已发送」当成「已读」</b>。
          <b>没收到回执不等于对方没看</b> —— 要确认请电话跟进,或让供应商在系统里点确认。
        </span>
      </Banner>

      <Card title="当前配置" sub="口令只存服务端环境变量,页面与接口都不回传">
        <table className="tbl">
          <tbody>
            <tr>
              <td>服务器</td>
              <td className="mono">{provider.config.host ?? "—"}</td>
            </tr>
            <tr>
              <td>端口</td>
              <td className="mono">{provider.config.port ?? "—"}</td>
            </tr>
            <tr>
              <td>加密</td>
              <td>{provider.config.secure ? "隐式 TLS(SSL)" : "STARTTLS / 明文"}</td>
            </tr>
            <tr>
              <td>发件人</td>
              <td className="mono">{provider.config.from ?? "—"}</td>
            </tr>
            <tr>
              <td>账号</td>
              <td className="mono">{provider.config.user ?? "—"}</td>
            </tr>
            <tr>
              <td>口令</td>
              <td className="muted small">
                {process.env.SMTP_PASSWORD ? "已配置(不显示)" : "未配置"}
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: 10 }}>
          <MailVerify />
        </div>
      </Card>

      <Card title="外发邮件统计" sub="状态由发送流程写入,不是估算">
        <div className="kpi-grid">
          {[
            ["草稿 · 未发送", "DRAFT"],
            ["已排队", "QUEUED"],
            ["已发送", "SENT"],
            ["发送失败", "DELIVERY_FAILED"],
          ].map(([label, key]) => (
            <div className="kpi" key={key}>
              <div className="kpi-label">{label}</div>
              <div className="kpi-value">{byState[key] ?? 0}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
