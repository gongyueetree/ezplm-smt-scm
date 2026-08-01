import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { credentialKeyAvailable } from "@/lib/server/erp-credentials";
import { loadPermissions } from "@/lib/server/permissions";
import { listConnections } from "@/lib/server/repositories/erp-connection";
import { getSession } from "@/lib/server/session";
import { ErpWizard } from "./wizard";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { text: string; tone: "gray" | "amber" | "green" | "blue" | "red" }> = {
  NOT_CONFIGURED: { text: "待联调", tone: "amber" },
  PENDING_TEST: { text: "待测试", tone: "gray" },
  CONNECTED: { text: "已连接(实测通过)", tone: "green" },
  DEGRADED: { text: "可连但能力不全", tone: "blue" },
  FAILED: { text: "连接失败", tone: "red" },
  DISABLED: { text: "已停用", tone: "gray" },
};

const VENDOR_LABEL: Record<string, string> = {
  KINGDEE: "金蝶",
  YONYOU: "用友",
  SAP: "SAP",
  ORACLE: "Oracle",
  EXCEL: "Excel / CSV",
  MOCK: "示例(Mock)",
};

export default async function ErpIntegrationPage() {
  const session = (await getSession())!;
  const perms = await loadPermissions(session);
  const canManage = perms.has("erp.connection.manage");
  const canPreview = perms.has("erp.sync.preview");
  const [connections, keyOk] = await Promise.all([
    listConnections(session),
    Promise.resolve(credentialKeyAvailable()),
  ]);

  return (
    <div>
      <PageHeader path="/settings/integrations/erp" />

      <Banner tone="soft">
        <span>
          <b>「已连接」只在真实请求成功后才会出现</b> —— 未配凭据一律显示「待联调」,
          不存在固定绿灯。凭据由服务端加密保存,接口与日志<b>只回掩码,不回明文</b>。
          一期真实可跑的是 <b>Excel/CSV</b> 与 <b>示例(Mock)</b>;
          金蝶为**真实 Adapter 骨架**(登录端点与字段表已就位,待客户账套联调);
          用友 / SAP / Oracle 为接口骨架,调用会明确报「尚未联调」而<b>不会返回空数据冒充同步完成</b>。
        </span>
      </Banner>

      {!keyOk ? (
        <div className="banner warn">
          未配置 <span className="mono">ERP_CREDENTIAL_KEY</span>(也没有 AUTH_SECRET 可派生)——
          <b>系统将拒绝保存任何 ERP 凭据</b>,不会降级成明文存储。请先配置加密密钥。
        </div>
      ) : null}

      {canManage ? <ErpWizard /> : null}

      <Card title="ERP 连接" sub={`${connections.length} 个 · 状态由真实测试结果决定`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>名称</th>
                <th>厂商 / 版本</th>
                <th>状态</th>
                <th>最近测试</th>
                <th>凭据</th>
                <th>同步频率</th>
              </tr>
            </thead>
            <tbody>
              {connections.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    尚未配置任何 ERP 连接
                  </td>
                </tr>
              ) : (
                connections.map((c) => {
                  const s = STATUS_LABEL[c.status] ?? { text: c.status, tone: "gray" as const };
                  return (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td className="small">
                        {VENDOR_LABEL[c.vendor] ?? c.vendor}
                        {c.edition ? ` · ${c.edition}` : ""}
                      </td>
                      <td>
                        <Badge tone={s.tone}>{s.text}</Badge>
                      </td>
                      <td className="small muted">
                        {c.lastTestAt ? c.lastTestAt.slice(0, 16).replace("T", " ") : "从未测试"}
                      </td>
                      <td className="small mono">
                        {c.credentials.length === 0 ? (
                          <span className="muted">未配置</span>
                        ) : (
                          c.credentials.map((cr) => `${cr.field}=${cr.maskedHint}`).join(" · ")
                        )}
                      </td>
                      <td className="small muted">{c.syncCron ?? "仅手工"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!canPreview ? (
          <p className="small muted" style={{ padding: "10px 16px" }}>
            你当前只有查看权限 —— 预览与执行同步需要 <span className="mono">erp.sync.preview</span> /{" "}
            <span className="mono">erp.sync.execute</span> 权限。
          </p>
        ) : null}
      </Card>
    </div>
  );
}
