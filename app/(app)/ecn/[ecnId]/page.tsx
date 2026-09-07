import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import {
  canDecideStage,
  currentStage,
  ECN_PRIORITY_LABEL,
  ECN_STAGE_LABEL,
  ECN_STATUS_LABEL,
  ECN_TYPE_LABEL,
  type EcnStageValue,
  type EcnStatusValue,
} from "@/lib/domain/ecn";
import { prisma } from "@/lib/server/db";
import { stageConfig } from "@/lib/server/repositories/ecn";
import { getTenantSettings } from "@/lib/server/tenant-settings";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { formatDate, formatDateTime } from "@/lib/format/datetime";
import { EcnActions } from "./actions";
import { ImpactPanel } from "./impact-panel";

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

/** F2:ECN 详情(头 + 变更行 + 审批历史 + 状态动作 + T2 面板 + T3 占位) */
export default async function EcnDetailPage({ params }: { params: Promise<{ ecnId: string }> }) {
  const { ecnId } = await params;
  const session = (await getSession())!;
  const { settings } = await getTenantSettings(session.tenantId);

  const ecn = await prisma.ecn.findFirst({
    where: tenantWhere(session.tenantId, { id: ecnId }),
    include: {
      changeLines: { orderBy: { lineNo: "asc" } },
      approvals: { orderBy: { decidedAt: "asc" } },
      customerNotices: true,
    },
  });
  if (!ecn) notFound();

  const cfg = await stageConfig(session.tenantId);
  const status = ecn.status as EcnStatusValue;
  const approvedStages = new Set<EcnStageValue>(
    ecn.approvals
      .filter((a) => a.decision === "APPROVED" && ecn.submittedAt && a.decidedAt >= ecn.submittedAt)
      .map((a) => a.stage as EcnStageValue),
  );
  const stage = status === "REVIEW" ? currentStage(cfg, approvedStages) : null;
  const canDecide = stage ? canDecideStage(stage, session.roles) : false;

  const customer = ecn.customerId
    ? await prisma.customer.findFirst({
        where: tenantWhere(session.tenantId, { id: ecn.customerId }),
        select: { name: true },
      })
    : null;

  const appliedVersions = await prisma.bOMVersion.findMany({
    where: tenantWhere(session.tenantId, { ecnId: ecn.id }),
    include: { bom: { select: { id: true, name: true } } },
  });

  // Apply to BOM 的候选 BOM(受影响的 + 正式 BOM 优先;简单列出全部正式 BOM)
  const boms = await prisma.bOM.findMany({
    where: tenantWhere(session.tenantId),
    select: { id: true, name: true, purpose: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <BackLink href="/ecn" label="ECN 列表" />
      <div className="page-head">
        <div>
          <h1 className="page-title" data-testid="ecn-title">
            {ecn.code} · {ecn.title}
          </h1>
          <p className="page-desc">
            {ECN_TYPE_LABEL[ecn.type] ?? ecn.type} · 优先级 {ECN_PRIORITY_LABEL[ecn.priority] ?? ecn.priority}
            {customer ? ` · 客户 ${customer.name}` : ""}
            {ecn.productName ? ` · 产品 ${ecn.productName}` : ""}
            {ecn.dueDate ? ` · 截止 ${formatDate(ecn.dueDate)}` : ""}
          </p>
        </div>
        <div className="page-actions">
          <Badge tone={STATUS_TONE[ecn.status] ?? "gray"}>
            {ECN_STATUS_LABEL[status] ?? ecn.status}
          </Badge>
          {stage ? <Badge tone="amber">当前阶段:{ECN_STAGE_LABEL[stage]}</Badge> : null}
          <a className="btn" href={`/api/ecn/${ecn.id}/export`} data-testid="ecn-export">
            导出
          </a>
        </div>
      </div>

      {ecn.status === "VOIDED" ? (
        <Banner tone="warn">
          <span data-testid="ecn-voided-banner">
            <b>已作废</b>(可查可溯,不可物理删除):{ecn.voidReason ?? "—"} ·{" "}
            {ecn.voidedAt ? formatDateTime(ecn.voidedAt) : ""}
          </span>
        </Banner>
      ) : null}
      {ecn.releasedSnapshot ? (
        <Banner tone="soft">
          <span>
            已发布(快照冻结于 {ecn.releasedAt ? formatDateTime(ecn.releasedAt) : "—"})——
            导出与展示以快照为准;<b>发布不自动改 BOM</b>,Apply to BOM 需显式二次确认。
          </span>
        </Banner>
      ) : null}

      <EcnActions
        ecnId={ecn.id}
        status={status}
        stage={stage}
        canDecide={canDecide}
        canManage={session.roles.includes("MANAGEMENT")}
        isFrozen={status !== "DRAFT"}
        lineCount={ecn.changeLines.length}
        boms={boms}
        canEditLines={session.roles.some((r) => r === "PM" || r === "ENGINEERING" || r === "MANAGEMENT")}
      />

      <Card title="变更行" sub={`${ecn.changeLines.length} 行 · 新料候选可引用既有替代关系/报价,不新建模型`} flush>
        <div className="tbl-scroll">
          <table className="tbl" data-testid="ecn-lines-table">
            <thead>
              <tr>
                <th>行</th>
                <th>旧内部料号 / MPN</th>
                <th>新内部料号 / MPN</th>
                <th>数量影响</th>
                <th>原因</th>
                <th>工程备注</th>
                <th>采购备注</th>
              </tr>
            </thead>
            <tbody>
              {ecn.changeLines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                    暂无变更行 —— 至少一行才能提交评审
                  </td>
                </tr>
              ) : (
                ecn.changeLines.map((l) => (
                  <tr key={l.id}>
                    <td className="num">{l.lineNo}</td>
                    <td className="small">
                      {l.oldInternalPn ?? "—"} / {l.oldMpn ?? "—"}
                    </td>
                    <td className="small">
                      {l.newInternalPn ?? "—"} / {l.newMpn ?? "—"}
                    </td>
                    <td className="num">{l.qtyImpact?.toString() ?? "—"}</td>
                    <td className="small">{l.reason ?? "—"}</td>
                    <td className="small">{l.engineeringNote ?? "—"}</td>
                    <td className="small">{l.procurementNote ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="评审与审批历史" sub="阶段固定 工程 → 采购 → 管理(租户可停用前两段);每次动作写审计" flush>
        <table className="tbl" data-testid="ecn-approvals">
          <thead>
            <tr>
              <th>阶段</th>
              <th>结论</th>
              <th>意见</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {ecn.approvals.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                  尚无审批记录
                </td>
              </tr>
            ) : (
              ecn.approvals.map((a) => (
                <tr key={a.id}>
                  <td>{ECN_STAGE_LABEL[a.stage as EcnStageValue] ?? a.stage}</td>
                  <td>
                    <Badge tone={a.decision === "APPROVED" ? "green" : "red"}>
                      {a.decision === "APPROVED" ? "通过" : "退回"}
                    </Badge>
                  </td>
                  <td className="small">{a.comment ?? "—"}</td>
                  <td className="small">{formatDateTime(a.decidedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {appliedVersions.length > 0 ? (
        <Card title="Apply to BOM 生成的版本" flush>
          <table className="tbl" data-testid="ecn-applied-versions">
            <tbody>
              {appliedVersions.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link href={`/bom/${v.bom.id}?tab=versions&v=${v.id}`}>
                      {v.bom.name} · V{v.versionNo}
                    </Link>
                  </td>
                  <td className="small muted">{formatDateTime(v.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {settings.featureFlags["ecn.impactAnalysis"] ? <ImpactPanel ecnId={ecn.id} /> : null}

      {/* T3 占位:待商务确认,无示例数据 */}
      <details style={{ marginTop: 12 }}>
        <summary className="small muted" data-testid="ecn-t3-placeholder">
          MES 同步指令 · 流程引擎/模拟器 · 品质评审阶段 · 客户签章(二期 · 待商务确认)
        </summary>
        <Banner tone="soft">
          <span>
            MES 指令(LOCK/RELEASE MBOM、Feeder/AOI/ICT 程序更新)、7 节点动态评审模板、
            品质评审阶段与客户签章/回函解析均<b>待商务确认</b>,本页不放任何示例数据。
          </span>
        </Banner>
      </details>
    </div>
  );
}
