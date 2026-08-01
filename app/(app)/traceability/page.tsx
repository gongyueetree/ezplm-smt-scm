import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { loadPermissions } from "@/lib/server/permissions";
import { listImportBatches, listIncidents } from "@/lib/server/repositories/traceability";
import { getSession } from "@/lib/server/session";
import { TraceConsole } from "./console";

export const dynamic = "force-dynamic";

const TEMPLATE_LABEL: Record<string, string> = {
  RECEIPT: "收料批次",
  WO_ISSUE: "工单用料",
  SHIPMENT: "出货关系",
};

const STATE_LABEL: Record<string, { text: string; tone: "gray" | "amber" | "green" | "blue" | "red" }> = {
  SUGGESTED: { text: "建议", tone: "gray" },
  PENDING_APPROVAL: { text: "待确认", tone: "amber" },
  REGISTERED_LOCALLY: { text: "本系统已登记", tone: "green" },
  PENDING_EXTERNAL: { text: "待外部系统执行", tone: "blue" },
  EXTERNAL_CONFIRMED: { text: "外部系统已确认", tone: "green" },
  FAILED: { text: "执行失败", tone: "red" },
  REJECTED: { text: "已驳回", tone: "red" },
};

export default async function TraceabilityPage() {
  const session = (await getSession())!;
  const perms = await loadPermissions(session);
  const [batches, incidents] = await Promise.all([
    listImportBatches(session),
    listIncidents(session),
  ]);

  return (
    <div>
      <PageHeader path="/traceability" />

      <Banner tone="soft">
        <span>
          <b>当前追溯粒度:批次级</b> · SN 级追溯待 MES/SN 数据接入(本系统无 SN 数据源,
          <b>不以批次冒充 SN</b>)。数据来自三张导入模板与 ERP 同步 —— <b>本系统没有 MES</b>。
          某一段查不到数据时会显示<b>数据缺口与可能原因</b>,而不是把影响算成 0。
          隔离处置只在本系统登记并需人工审批,<b>不代表 ERP/产线已实际执行</b>。
        </span>
      </Banner>

      <TraceConsole
        canImport={perms.has("trace.import")}
        canAnalyze={perms.has("trace.analyze")}
        canPropose={perms.has("trace.containment.propose")}
        canApprove={perms.has("trace.containment.approve")}
      />

      <Card title="质量事件与处置" sub={`${incidents.length} 起 · 提议与批准分离`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>编号</th>
                <th>标题</th>
                <th>异常源</th>
                <th>处置动作</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {incidents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无质量事件
                  </td>
                </tr>
              ) : (
                incidents.map((i) => (
                  <tr key={i.id}>
                    <td className="mono small">{i.code}</td>
                    <td className="small">{i.title}</td>
                    <td className="mono small">{i.sourceRef}</td>
                    <td className="small">
                      {i.actions.length === 0 ? (
                        <span className="muted">未提议</span>
                      ) : (
                        i.actions.map((a) => (
                          <div key={a.id}>
                            {a.kind} → <span className="mono">{a.targetRef}</span>{" "}
                            <Badge tone={STATE_LABEL[a.state]?.tone ?? "gray"}>
                              {STATE_LABEL[a.state]?.text ?? a.state}
                            </Badge>
                            {a.externalNote ? (
                              <div className="muted" style={{ fontSize: 11 }}>
                                {a.externalNote}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </td>
                    <td>
                      <Badge tone={i.status === "OPEN" ? "amber" : "gray"}>{i.status}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="导入批次" sub={`${batches.length} 次 · 行级校验结果留痕`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>模板</th>
                <th>文件</th>
                <th className="num">总行 / 成功 / 失败</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    尚未导入任何追溯数据 —— 没有数据不等于没有影响,请先导入三张模板
                  </td>
                </tr>
              ) : (
                batches.map((b) => (
                  <tr key={b.id}>
                    <td className="small">{TEMPLATE_LABEL[b.template] ?? b.template}</td>
                    <td className="small muted">{b.fileName ?? "粘贴导入"}</td>
                    <td className="num small">
                      {b.totalRows} / {b.okRows} /{" "}
                      <span style={{ color: b.errorRows > 0 ? "var(--danger)" : undefined }}>{b.errorRows}</span>
                    </td>
                    <td className="small muted">{b.createdAt.slice(0, 16).replace("T", " ")}</td>
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
