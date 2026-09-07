import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { MpnLink } from "@/components/ui/mpn-link";
import { PageHeader } from "@/components/ui/page-header";
import { SOURCING_MODE_LABELS } from "@/lib/domain/po-scheduling";
import { PO_STATUS_LABELS } from "@/lib/domain/po-status";
import { resolveErpTarget } from "@/lib/server/repositories/integration-sync";
import { linkConfirmStateForPo } from "@/lib/server/repositories/supplier-action";
import { getPurchaseOrder } from "@/lib/server/repositories/purchase-order";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { PoActions } from "./actions";

export const dynamic = "force-dynamic";

const VERDICT_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  持平: "green",
  下降: "green",
  上涨: "amber",
  涨幅超线: "red",
  首次采购: "gray",
  不可比: "gray",
};

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  const session = (await getSession())!;
  const { poId } = await params;
  const po = await getPurchaseOrder(session, poId);
  if (!po) notFound();

  const unresolved = po.lines.filter((l) => l.wasFlagged && !l.resolution).length;
  const liveErrors = po.lines.filter((l) => l.review?.hasError).length;

  // F3:免登录确认状态(Supplier Confirmed via Link)
  const linkState = await linkConfirmStateForPo(session.tenantId, po.poNo, po.supplierId);

  // F4:API 回写状态(与 Excel 模板并列展示,互不取代)
  const [erpTarget, syncRecord] = await Promise.all([
    resolveErpTarget(session.tenantId),
    prisma.integrationSyncRecord.findFirst({
      where: tenantWhere(session.tenantId, {
        entityType: "PURCHASE_ORDER" as const,
        entityId: po.id,
        direction: "EZPLM_TO_ERP" as const,
      }),
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return (
    <div>
      <PageHeader path="/procurement/orders" />

      <Card
        title={`${po.poNo}`}
        sub={`${PO_STATUS_LABELS[po.status]} · ${po.currency} · ${po.lines.length} 行`}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone={po.frozen ? "amber" : "gray"}>
            {po.frozen ? "行项已冻结" : "可编辑"}
          </Badge>
          {po.erpExportedAt ? (
            <Badge tone="blue">ERP 模板已导出 {po.erpExportedAt.slice(0, 10)}</Badge>
          ) : null}
          {po.policyConfirmed ? null : <Badge tone="amber">阈值口径未确认</Badge>}
        </div>
        {po.rejectReason ? (
          <div className="banner warn" style={{ marginTop: 10 }}>
            <b>退回原因:</b>
            {po.rejectReason}
          </div>
        ) : null}
        {po.cancelReason ? (
          <div className="banner warn" style={{ marginTop: 10 }}>
            <b>作废原因:</b>
            {po.cancelReason}
          </div>
        ) : null}
        <Banner tone="soft">
          <span>
            审批通过后本单只到「<b>已审批 · 待 ERP 录入</b>」;导出模板后为「已导出 ERP 模板」。
            <b>导出不代表 ERP 已接单</b> —— ERP 是下单执行的真源,本系统不直接下单。
          </span>
        </Banner>
      </Card>

      <PoActions
        poId={po.id}
        status={po.status}
        frozen={po.frozen}
        unresolved={unresolved}
        liveErrors={liveErrors}
        erpExported={Boolean(po.erpExportedAt)}
        supplierConfirm={{
          ack: linkState.ack
            ? { decision: linkState.ack.decision, note: linkState.ack.note, at: linkState.ack.recordedAt.toISOString() }
            : null,
          pendingLink: linkState.pendingLink
            ? { expiresAt: linkState.pendingLink.expiresAt.toISOString() }
            : null,
        }}
        erpApi={{
          configured: erpTarget.kind !== "NONE",
          targetLabel:
            erpTarget.kind === "ERP_LAB"
              ? "ERP 仿真环境(非金蝶)"
              : erpTarget.kind === "NONE"
                ? null
                : erpTarget.kind,
          notConfiguredReason: erpTarget.kind === "NONE" ? erpTarget.reason : null,
          state: syncRecord?.state ?? null,
          documentNo: syncRecord?.externalDocumentNo ?? syncRecord?.externalId ?? null,
          errorMessage: syncRecord?.errorMessage ?? null,
        }}
      />

      <Card
        title="订单行"
        sub={`异常 ${po.lines.filter((l) => l.wasFlagged).length} 行 · 未处理 ${unresolved} 行 · 涨幅告警线 ${po.maxIncreaseRate}`}
        flush
      >
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>行</th>
                <th>MPN</th>
                <th className="num">数量</th>
                <th className="num">单价</th>
                <th>历史价对比</th>
                <th>需求日 / 建议下单日</th>
                <th>模式</th>
                <th>异常与处理</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => {
                const hist = l.review?.history ?? null;
                const flags = l.review?.flags ?? [];
                return (
                  <tr key={l.id}>
                    <td>{l.lineNo}</td>
                    <td>{l.mpn ? <MpnLink mpn={l.mpn} /> : <span className="muted">—</span>}</td>
                    <td className="num">
                      {l.qty}
                      {l.moq || l.spq ? (
                        <div className="small muted">
                          MOQ {l.moq ?? "—"} · SPQ {l.spq ?? "—"}
                        </div>
                      ) : null}
                    </td>
                    <td className="num">
                      {l.unitPrice ? `${l.currency} ${l.unitPrice}` : <span className="muted">未填</span>}
                    </td>
                    <td className="small">
                      {hist ? (
                        <>
                          <Badge tone={VERDICT_TONE[hist.verdict] ?? "gray"}>{hist.verdict}</Badge>
                          <div className="muted">{hist.detail}</div>
                        </>
                      ) : (
                        <span className="muted">
                          已冻结 —— 见提交复核时固化的快照
                        </span>
                      )}
                    </td>
                    <td className="small">
                      {l.requestDate?.slice(0, 10) ?? "—"}
                      <div className="muted">
                        {l.orderByDate ? (
                          `建议下单 ${l.orderByDate.slice(0, 10)}`
                        ) : (
                          <span>交期未预设,未反推</span>
                        )}
                      </div>
                    </td>
                    <td className="small">{SOURCING_MODE_LABELS[l.sourcingMode]}</td>
                    <td className="small">
                      {flags.length === 0 && !l.wasFlagged ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          {flags.map((f, i) => (
                            <div
                              key={i}
                              style={{ color: f.severity === "error" ? "var(--danger)" : undefined }}
                            >
                              {f.severity === "error" ? "⚠ " : ""}
                              {f.detail}
                            </div>
                          ))}
                          {l.resolution ? (
                            <div>
                              <Badge tone="green">已处理:{l.resolution}</Badge>
                              {l.resolutionNote ? (
                                <div className="muted">{l.resolutionNote}</div>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="审批流" sub="价格复核与终审各自留痕" flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>环节</th>
                <th>结论</th>
                <th>意见</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {po.approvals.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                    尚未提交任何审批环节
                  </td>
                </tr>
              ) : (
                po.approvals.map((a) => (
                  <tr key={a.id}>
                    <td className="small">
                      {a.stage === "PRICE_REVIEW" ? "价格复核" : "终审"}
                    </td>
                    <td>
                      <Badge
                        tone={
                          a.decision === "APPROVED"
                            ? "green"
                            : a.decision === "REJECTED"
                              ? "red"
                              : "amber"
                        }
                      >
                        {a.decision === "APPROVED" ? "通过" : a.decision === "REJECTED" ? "退回" : "待处理"}
                      </Badge>
                    </td>
                    <td className="small muted">{a.comment ?? "—"}</td>
                    <td className="small muted">
                      {(a.decidedAt ?? a.createdAt).slice(0, 16).replace("T", " ")}
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
