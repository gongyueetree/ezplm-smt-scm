import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { BackLink } from "@/components/shell/back-link";
import {
  PROCESS_STATE_LABEL,
  type AttachmentProcessState,
} from "@/lib/domain/attachment-limits";
import {
  RFQ_STATUS_LABELS,
  availableTransitionsFor,
  type RfqStatusValue,
} from "@/lib/domain/rfq-status";
import { getRfq } from "@/lib/server/repositories/rfq";
import { getSession } from "@/lib/server/session";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { RfqActions } from "./actions";
import { formatDate, formatDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await getSession())!;
  const rfq = await getRfq(session, id);
  if (!rfq) notFound();

  const customer = await prisma.customer.findFirst({
    where: tenantWhere(session.tenantId, { id: rfq.customerId }),
  });
  const status = rfq.status as RfqStatusValue;
  const transitions = availableTransitionsFor(status, session.roles);

  return (
    <div>
      <BackLink href="/rfq" label="RFQ 询价" />
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {rfq.code} · {rfq.title}
          </h1>
          <p className="page-desc">
            客户 {customer?.name ?? rfq.customerId} · 创建于{" "}
            {formatDateTime(rfq.createdAt)} · 截止{" "}
            {rfq.dueAt ? formatDate(rfq.dueAt) : "未设置"}
          </p>
        </div>
        <div className="page-actions">
          <Badge tone={status === "CLOSED_NO_QUOTE" || status === "LOST" ? "red" : "blue"}>
            {RFQ_STATUS_LABELS[status]}
          </Badge>
        </div>
      </div>

      {rfq.closedReason ? (
        <Banner tone="warn">
          <span>
            <b>已不报价关闭</b>:{rfq.closedReason}
          </span>
        </Banner>
      ) : null}

      <RfqActions
        rfqId={rfq.id}
        transitions={transitions}
        readOnly={transitions.length === 0}
        quoteQtys={Array.isArray(rfq.quoteQtys) ? (rfq.quoteQtys as number[]) : []}
      />

      <Card title="附件" sub={`${rfq.attachments.length} 个 · 保留原始客户文件`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>文件名</th>
                <th>类型</th>
                <th className="num">大小</th>
                <th>处理状态</th>
                <th>上传时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rfq.attachments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                    暂无附件
                  </td>
                </tr>
              ) : (
                rfq.attachments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.fileName}</td>
                    <td>
                      <Badge tone="gray">{a.type}</Badge>
                    </td>
                    <td className="num small">
                      {a.sizeBytes
                        ? a.sizeBytes >= 1024 * 1024
                          ? `${(a.sizeBytes / 1024 / 1024).toFixed(1)} MB`
                          : `${(a.sizeBytes / 1024).toFixed(1)} KB`
                        : "-"}
                    </td>
                    {/*
                      E1b:**保存**与**解析**分开显示。
                      Gerber 在 RFQ 阶段只留档不解析 —— 不写清楚的话,
                      用户会以为传上去就等于系统读懂了。
                    */}
                    <td className="small">
                      <Badge tone={a.processState === "PARSED" ? "green" : "gray"}>
                        {PROCESS_STATE_LABEL[
                          (a.processState ?? "UPLOADED_NOT_PARSED") as AttachmentProcessState
                        ] ?? a.processState}
                      </Badge>
                      {a.processNote ? (
                        <div className="muted" style={{ maxWidth: 320 }}>
                          {a.processNote}
                        </div>
                      ) : null}
                    </td>
                    <td className="small">
                      {formatDateTime(a.createdAt)}
                    </td>
                    <td>
                      <Link className="btn sm" href={`/api/files/${a.fileKey}`}>
                        下载原件
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="关联 BOM" sub={`${rfq.boms.length} 个`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>BOM 名称</th>
                <th className="num">最新版本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rfq.boms.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                    暂无 BOM —— 到「BOM 导入」上传,并在导入时选择本 RFQ
                  </td>
                </tr>
              ) : (
                rfq.boms.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td className="num">V{b.versions[0]?.versionNo ?? "-"}</td>
                    <td>
                      {b.versions[0] ? (
                        <Link className="btn sm" href={`/bom/version/${b.versions[0].id}`}>
                          查看匹配
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="处理记录" sub={`${rfq.statusHistory.length} 条`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>时间</th>
                <th>流转</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {rfq.statusHistory.map((h) => (
                <tr key={h.id}>
                  <td className="small">{formatDateTime(h.createdAt)}</td>
                  <td className="small">
                    {h.fromStatus ? RFQ_STATUS_LABELS[h.fromStatus as RfqStatusValue] : "—"} →{" "}
                    <b>{RFQ_STATUS_LABELS[h.toStatus as RfqStatusValue]}</b>
                  </td>
                  <td className="small muted">{h.note ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
