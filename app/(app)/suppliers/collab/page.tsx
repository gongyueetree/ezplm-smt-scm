import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { draftStatusLabel } from "@/lib/domain/email-draft";
import type { PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { CollabActions } from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  PO_DISPATCH: "订单发送",
  PO_ACK_REQUEST: "接单确认",
  SUPPLIER_ONBOARD: "供应商建档邀请",
};

export default async function SupplierCollabPage() {
  const session = (await getSession())!;

  // 枚举数组要显式收窄,否则 Prisma 的重载匹配不上
  const dispatchable: PurchaseOrderStatus[] = ["APPROVED", "EXPORTED"];

  const [drafts, invites, acks, orders] = await Promise.all([
    prisma.emailDraft.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.supplierOnboardInvite.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.poAcknowledgement.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { recordedAt: "desc" },
      take: 50,
    }),
    prisma.purchaseOrder.findMany({
      where: tenantWhere(session.tenantId, { status: { in: dispatchable } }),
      select: { id: true, poNo: true, supplierId: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <div>
      <PageHeader path="/suppliers/collab" />

      <Banner tone="warn">
        <span>
          <b>邮件通道未接入</b>:本页所有「发送」类动作产出的都是<b>邮件草稿</b>,
          系统<b>不会自动发出任何邮件</b>,需人工复制或下载后自行发出。
          草稿状态只有「草稿(未发送)」与「已预览(未发送)」——
          <b>没有「已发送」这个状态</b>。
          供应商经邀请链接提交的资料,在人工复核通过前<b>不进入正式主数据</b>。
        </span>
      </Banner>

      <CollabActions
        orders={orders.map((o) => ({ id: o.id, poNo: o.poNo }))}
      />

      <Card title="邮件草稿" sub={`${drafts.length} 封 · 均未发送`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>类型</th>
                <th>收件人</th>
                <th>主题</th>
                <th>状态</th>
                <th>生成时间</th>
              </tr>
            </thead>
            <tbody>
              {drafts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无草稿
                  </td>
                </tr>
              ) : (
                drafts.map((d) => (
                  <tr key={d.id}>
                    <td className="small">{KIND_LABEL[d.kind] ?? d.kind}</td>
                    <td className="small">
                      {d.toName ?? "—"}
                      <div className="muted">{d.toEmail ?? "未填邮箱"}</div>
                    </td>
                    <td className="small">{d.subject}</td>
                    <td>
                      <Badge tone="amber">{draftStatusLabel(d.status)}</Badge>
                    </td>
                    <td className="small muted">
                      {d.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="供应商建档邀请" sub={`${invites.length} 条`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>公司</th>
                <th>邮箱</th>
                <th>状态</th>
                <th>有效期</th>
                <th>邀请链接</th>
              </tr>
            </thead>
            <tbody>
              {invites.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无邀请
                  </td>
                </tr>
              ) : (
                invites.map((i) => (
                  <tr key={i.id}>
                    <td className="small">{i.companyName ?? "—"}</td>
                    <td className="small">{i.toEmail ?? "—"}</td>
                    <td>
                      <Badge tone={i.status === "ACCEPTED" ? "green" : i.status === "SUBMITTED" ? "blue" : "gray"}>
                        {i.status === "PENDING"
                          ? "待供应商回填"
                          : i.status === "SUBMITTED"
                            ? "已提交,待复核"
                            : "已建档"}
                      </Badge>
                    </td>
                    <td className="small muted">{i.expiresAt?.toISOString().slice(0, 10) ?? "不限"}</td>
                    <td className="small mono">/onboard/{i.token.slice(0, 8)}…</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="接单回执" sub={`${acks.length} 条 · 人工登记`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>PO 号</th>
                <th>结论</th>
                <th>来源</th>
                <th>说明</th>
                <th>登记时间</th>
              </tr>
            </thead>
            <tbody>
              {acks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无回执
                  </td>
                </tr>
              ) : (
                acks.map((a) => (
                  <tr key={a.id}>
                    <td className="mono small">{a.poNo}</td>
                    <td>
                      <Badge
                        tone={
                          a.decision === "ACCEPTED" ? "green" : a.decision === "REJECTED" ? "red" : "amber"
                        }
                      >
                        {a.decision === "ACCEPTED" ? "接受" : a.decision === "REJECTED" ? "拒绝" : "部分接受"}
                      </Badge>
                    </td>
                    <td className="small muted">
                      {a.source === "EMAIL_MANUAL" ? "邮件(人工登记)" : a.source === "PHONE" ? "电话" : "门户"}
                    </td>
                    <td className="small muted">{a.note ?? "—"}</td>
                    <td className="small muted">
                      {a.recordedAt.toISOString().slice(0, 16).replace("T", " ")}
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
