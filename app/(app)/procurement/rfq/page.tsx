import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { CreateProcurementRfqForm } from "./create-form";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { text: string; tone: "gray" | "blue" | "green" | "amber" }> = {
  DRAFT: { text: "草稿", tone: "gray" },
  SOURCING: { text: "比价中", tone: "blue" },
  FEEDBACK_READY: { text: "已反馈 PM", tone: "green" },
  CLOSED: { text: "已关闭", tone: "gray" },
};

export default async function ProcurementRfqPage() {
  const session = (await getSession())!;
  const [items, versions] = await Promise.all([
    prisma.procurementRFQ.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { supplierQuotes: true } } },
    }),
    prisma.bOMVersion.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { createdAt: "desc" },
      include: { bom: { select: { name: true } } },
      take: 30,
    }),
  ]);
  const canCreate = session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT");

  return (
    <div>
      <PageHeader path="/procurement/rfq" />
      <Banner tone="ai">
        <span>
          比价集合以<b>同一颗料</b>组织:同号异厂、异币种、圆整后取不到阶梯价的报价会被
          <b>标注排除原因</b>而非静默丢弃;系统<b>不做汇率换算</b>。
          推荐综合价格/库存/交期/生命周期/供应商优先级,<b>最低价与推荐分别标识</b>;
          推荐仅为建议,采购可改可拒,<b>拒绝推荐必须写理由</b>。
        </span>
      </Banner>

      {canCreate ? (
        <CreateProcurementRfqForm
          versions={versions.map((v) => ({
            id: v.id,
            label: `${v.bom.name} V${v.versionNo}`,
          }))}
        />
      ) : (
        <Banner tone="soft">当前角色只读:仅采购与管理层可创建采购 RFQ。</Banner>
      )}

      <Card title="采购 RFQ 列表" sub={`${items.length} 条`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>编号</th>
                <th>状态</th>
                <th>模式</th>
                <th className="num">供应商报价</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无采购 RFQ
                  </td>
                </tr>
              ) : (
                items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/procurement/rfq/${p.id}`} style={{ fontWeight: 600 }}>
                        {p.code}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={STATUS_LABEL[p.status]?.tone ?? "gray"}>
                        {STATUS_LABEL[p.status]?.text ?? p.status}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={p.sourcingMode === "SPOT" ? "green" : "amber"}>
                        {p.sourcingMode === "SPOT" ? "现货" : "期货"}
                      </Badge>
                    </td>
                    <td className="num">{p._count.supplierQuotes}</td>
                    <td className="small">{p.createdAt.toISOString().slice(0, 10)}</td>
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
