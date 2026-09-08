import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { SYNC_STATE_LABEL, type IntegrationSyncState } from "@/lib/domain/integration-sync";
import { fetchLabDatasetSummary } from "@/lib/providers/erp/lab/dataset";
import { listSyncStatus } from "@/lib/server/repositories/integration-sync";
import { getSession } from "@/lib/server/session";
import { getTenantSettings } from "@/lib/server/tenant-settings";
import { RetryButton } from "./retry-button";
import { RunWorkerButton } from "./run-worker";

export const dynamic = "force-dynamic";

const ENTITY_LABEL: Record<string, string> = {
  MATERIAL: "物料主数据",
  INVENTORY: "库存快照",
  EXCESS: "Excess 呆滞",
  SUPPLIER: "供应商档案",
  CUSTOMER: "客户档案",
  FX_RATE: "汇率(仅状态位)",
  OPEN_PO: "在途 PO",
  PURCHASE_ORDER: "采购订单回写",
  ETA_WRITEBACK: "交期回写",
  AR_AP: "AR/AP(预留)",
  WORK_ORDER: "工单",
  RECEIPT_LOT: "收料批次",
  SHIPMENT: "出货",
};

function stateTone(state: string): "green" | "amber" | "red" | "gray" {
  switch (state) {
    case "SYNCED":
      return "green";
    case "SYNCING":
    case "PENDING":
    case "RETRY_REQUIRED":
      return "amber";
    case "FAILED":
    case "BLOCKED":
      return "red";
    default:
      return "gray";
  }
}

/**
 * F4:Integration Status 管理页。
 *
 * 状态只反映真实记录:未配置显示「ERP 未配置」,不显示 0 条成功;
 * ERP_LAB 一律标注**仿真环境** —— 打通 Lab 不等于金蝶已联调。
 */
export default async function IntegrationStatusPage() {
  const session = (await getSession())!;
  const { target, records, datasets } = await listSyncStatus(session);
  // R3-6:目标是 Lab 时展示数据集就绪度(名/版本/种子时间/行数)——
  // 客户脱敏快照导到 Lab 后,主仓在这里可观测;NONE/金蝶不发这次请求
  const labSummary =
    target.kind === "ERP_LAB"
      ? await fetchLabDatasetSummary(
          (await getTenantSettings(session.tenantId)).settings.erpLabTenantId,
        )
      : null;

  return (
    <div>
      <BackLink href="/settings" label="系统设置" />
      <div className="page-head">
        <div>
          <h1 className="page-title">集成状态</h1>
          <p className="page-desc">实体级同步状态 · 人工重试 · Excel 兜底链入口</p>
        </div>
        <div className="page-actions">
          <RunWorkerButton />
          <span data-testid="erp-target-badge">
            <Badge tone={target.kind === "NONE" ? "gray" : "amber"}>
              {target.kind === "NONE"
                ? "ERP 未配置"
                : target.kind === "ERP_LAB"
                  ? "ERP 仿真环境(非金蝶)"
                  : target.kind}
            </Badge>
          </span>
        </div>
      </div>

      <Banner tone={target.kind === "NONE" ? "soft" : "warn"}>
        <span data-testid="erp-target-note">
          {target.kind === "NONE" ? (
            <>
              {target.reason ?? "租户未启用 ERP 集成。"}{" "}
              <b>Excel 模板兜底链不受影响</b>:采购订单页仍可导出 ERP 批量下单模板,
              回执按「已生成 → 已发送 → ERP 已接收 → ERP 已建单」逐级登记。
            </>
          ) : (
            <>
              当前回写目标为 <b>ERP 仿真环境(ezplm-erp-lab)</b> ——
              用于验证同步状态机与幂等重试,<b>不代表金蝶已联调</b>(金蝶待客户凭据,O1)。
              Excel 模板兜底链与 API 直写并列可用。
            </>
          )}
        </span>
      </Banner>

      {labSummary ? (
        <Card
          title="Lab 数据集就绪度(R3-6 · 仿真环境)"
          sub="客户脱敏快照在 Lab 界面导入;此处只读展示当前数据集现状 —— 不是金蝶"
        >
          <div data-testid="lab-dataset-summary" data-state={labSummary.state}>
            {labSummary.state !== "ok" ? (
              <p className="small muted">{labSummary.note}</p>
            ) : (
              <>
                <p className="small">
                  数据集 <b>{labSummary.dataset!.datasetName}</b>(租户 {labSummary.dataset!.tenantId})
                  · 版本 v{labSummary.dataset!.version} · 种子时间{" "}
                  {labSummary.dataset!.seededAt.slice(0, 19).replace("T", " ")} · 场景{" "}
                  <Badge tone={labSummary.dataset!.scenario === "NORMAL" ? "green" : "amber"}>
                    {labSummary.dataset!.scenario}
                  </Badge>
                  {labSummary.health ? (
                    <span className="muted"> · 健康 {labSummary.health.ok ? "正常" : "异常"}
                      {labSummary.health.latencyMs != null ? `(${labSummary.health.latencyMs}ms)` : ""}
                      {labSummary.health.version ? ` · Lab ${labSummary.health.version}` : ""}
                    </span>
                  ) : null}
                </p>
                <p className="small" data-testid="lab-dataset-counts">
                  {Object.entries(labSummary.dataset!.counts)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(" · ")}
                  {" · "}映射档案 {labSummary.dataset!.mappingProfiles}
                </p>
                <p className="small muted">
                  快照上传/场景注入/导入对账报告(含断裂引用)在 Lab 界面操作与呈现
                  {labSummary.labUrl ? <>:<code>{labSummary.labUrl}</code></> : null};
                  导入报告未持久化,本页不复述。
                </p>
              </>
            )}
          </div>
        </Card>
      ) : null}

      <Card title="数据集实体(读取方向)">
        <table className="tbl" data-testid="dataset-status-table">
          <thead>
            <tr>
              <th>实体</th>
              <th>状态</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {datasets.map((d) => (
              <tr key={d.entityType} data-testid={`dataset-${d.entityType}`}>
                <td>{ENTITY_LABEL[d.entityType] ?? d.entityType}</td>
                <td>
                  <Badge tone={stateTone(d.state)}>
                    {SYNC_STATE_LABEL[d.state as IntegrationSyncState] ?? d.state}
                  </Badge>
                </td>
                <td className="muted">{d.note}</td>
              </tr>
            ))}
            {datasets.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  全部数据集实体已有同步记录(见下表)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card title="业务对象同步记录">
        {records.length === 0 ? (
          <p className="muted" data-testid="sync-records-empty">
            暂无同步记录 —— 尚未发起过任何实体级同步。这不代表「全部已同步」,只代表还没开始。
          </p>
        ) : (
          <table className="tbl" data-testid="sync-records-table">
            <thead>
              <tr>
                <th>实体</th>
                <th>对象</th>
                <th>目标</th>
                <th>状态</th>
                <th>ERP 单号</th>
                <th>尝试</th>
                <th>关联 ID</th>
                <th>最近错误</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>{ENTITY_LABEL[r.entityType] ?? r.entityType}</td>
                  <td className="mono">{r.entityId === "dataset" ? "(数据集)" : r.entityId.slice(0, 12)}</td>
                  <td>{r.provider === "ERP_LAB" ? "仿真环境" : r.provider}</td>
                  <td>
                    <Badge tone={stateTone(r.state)}>
                      {SYNC_STATE_LABEL[r.state as IntegrationSyncState] ?? r.state}
                    </Badge>
                  </td>
                  <td className="mono">{r.externalDocumentNo ?? r.externalId ?? "—"}</td>
                  <td>{r.attemptCount}</td>
                  <td className="mono small">{r.correlationId ? r.correlationId.slice(0, 8) : "—"}</td>
                  <td className="muted" style={{ maxWidth: 360 }}>
                    {r.errorMessage ?? r.note ?? "—"}
                  </td>
                  <td>{r.canRetry ? <RetryButton recordId={r.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
