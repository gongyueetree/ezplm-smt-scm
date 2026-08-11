import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RFQ_STATUS_LABELS, type RfqStatusValue } from "@/lib/domain/rfq-status";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { CreateRfqForm } from "./create-form";
import { formatDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

const STATUS_TONE: Partial<Record<RfqStatusValue, "green" | "amber" | "red" | "gray" | "blue">> = {
  DRAFT: "gray",
  QUOTED: "green",
  CLOSED_NO_QUOTE: "red",
  LOST: "red",
  PENDING_APPROVAL: "amber",
};

export default async function RfqListPage() {
  const session = (await getSession())!;
  const [rfqs, customers] = await Promise.all([
    prisma.rFQ.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { attachments: true, boms: true } } },
    }),
    prisma.customer.findMany({ where: tenantWhere(session.tenantId), orderBy: { code: "asc" } }),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const canCreate = session.roles.some((r) => r === "PM" || r === "MANAGEMENT");

  return (
    <div>
      <PageHeader path="/rfq" />
      {canCreate ? (
        <CreateRfqForm customers={customers.map((c) => ({ id: c.id, name: c.name, code: c.code }))} />
      ) : (
        <Banner tone="soft">当前角色只读:仅 PM 与管理层可创建 RFQ。</Banner>
      )}

      <Card title="RFQ 列表" sub={`${rfqs.length} 条`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>编号</th>
                <th>标题</th>
                <th>客户</th>
                <th>状态</th>
                <th className="num">报价数量</th>
                <th className="num">BOM</th>
                <th className="num">附件</th>
                <th>截止时间</th>
              </tr>
            </thead>
            <tbody>
              {rfqs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无 RFQ,使用上方表单创建
                  </td>
                </tr>
              ) : (
                rfqs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/rfq/${r.id}`} style={{ fontWeight: 600 }}>
                        {r.code}
                      </Link>
                    </td>
                    <td>{r.title}</td>
                    <td className="small">{customerName.get(r.customerId) ?? r.customerId}</td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status as RfqStatusValue] ?? "blue"}>
                        {RFQ_STATUS_LABELS[r.status as RfqStatusValue]}
                      </Badge>
                    </td>
                    <td className="num small">
                      {Array.isArray(r.quoteQtys) ? (r.quoteQtys as number[]).join(" / ") : "-"}
                    </td>
                    <td className="num">{r._count.boms}</td>
                    <td className="num">{r._count.attachments}</td>
                    <td className="small">{r.dueAt ? formatDate(r.dueAt) : "-"}</td>
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
