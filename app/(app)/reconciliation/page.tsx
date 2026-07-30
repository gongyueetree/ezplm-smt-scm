import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/server/db";
import { allowedKinds } from "@/lib/server/recon-access";
import { listStatements } from "@/lib/server/repositories/reconciliation";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { CreateStatementForm } from "./create-form";

export const dynamic = "force-dynamic";

const KIND_LABEL = { AR: "应收(对客户)", AP: "应付(对供应商)" } as const;
const STATUS_LABEL: Record<string, { text: string; tone: "gray" | "blue" | "green" | "amber" }> = {
  DRAFT: { text: "草稿", tone: "gray" },
  MATCHED: { text: "已匹配", tone: "blue" },
  CONFIRMED: { text: "已确认", tone: "green" },
  CLOSED: { text: "已关闭", tone: "gray" },
};

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const kinds = allowedKinds(session.roles);

  if (kinds.length === 0) {
    return (
      <div>
        <PageHeader path="/reconciliation" />
        <Banner tone="warn">
          <span>
            当前角色无对账权限。<b>应收(AR)属 PM 侧,应付(AP)属采购侧</b>,管理层可看两侧。
          </span>
        </Banner>
      </div>
    );
  }

  const kind = kinds.includes(sp.kind as "AR" | "AP") ? (sp.kind as "AR" | "AP") : kinds[0];

  const [statements, customers, suppliers] = await Promise.all([
    listStatements(session, kind),
    prisma.customer.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.supplier.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const nameOf = (s: (typeof statements)[number]) => {
    if (s.kind === "AR") return customers.find((c) => c.id === s.customerId)?.name ?? "未指定客户";
    return suppliers.find((x) => x.id === s.supplierId)?.name ?? "未指定供应商";
  };

  const unresolvedTotal = statements.reduce((a, s) => a + s.unresolved, 0);

  return (
    <div>
      <PageHeader path="/reconciliation" />

      <Banner tone="soft">
        <span>
          <b>本系统不拥有出货、入库、发票记录</b> —— 那属 ERP 数据主权。
          因此「我方基准」只有两条来源:① 本系统<b>已批准单据派生</b>
          (应付取已批准/已导出 PO 行,应收取已批准报价行);② <b>ERP 导出明细上传</b>。
          每张对账单都会标明用的是哪一种,不假装系统已对上 ERP 流水。
          差异判定中<b>异币种不做汇率换算</b>;
          <b>金额对得上但数量/单价对不上的行绝不判一致</b>(两边记的不是同一件事)。
          对账单导出为可供人工发送的附件 —— <b>邮件通道未接入,系统不发送任何邮件</b>。
        </span>
      </Banner>

      {kinds.length > 1 ? (
        <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
          {kinds.map((k) => (
            <Link
              key={k}
              className={`btn${k === kind ? " primary" : ""}`}
              href={`/reconciliation?kind=${k}`}
            >
              {KIND_LABEL[k]}
            </Link>
          ))}
        </div>
      ) : (
        <p className="small muted" style={{ margin: "10px 0" }}>
          当前角色可见:<b>{KIND_LABEL[kind]}</b>(AR/AP 按角色与 Tab 区分)
        </p>
      )}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">对账单</div>
          <div className="kpi-value">{statements.length}</div>
          <div className="kpi-foot">{KIND_LABEL[kind]}</div>
        </div>
        <div className={unresolvedTotal > 0 ? "kpi danger" : "kpi"}>
          <div className="kpi-label">未处理差异行</div>
          <div className="kpi-value">{unresolvedTotal}</div>
          <div className="kpi-foot">含仅一方有的行</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">已匹配</div>
          <div className="kpi-value">
            {statements.filter((s) => s.status !== "DRAFT").length}
          </div>
          <div className="kpi-foot">草稿 {statements.filter((s) => s.status === "DRAFT").length}</div>
        </div>
      </div>

      <CreateStatementForm
        kind={kind}
        customers={customers}
        suppliers={suppliers}
      />

      <Card title={`${KIND_LABEL[kind]}对账台账`} sub={`${statements.length} 张 · 差异数由行级派生`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>对账单号</th>
                <th>{kind === "AR" ? "客户" : "供应商"}</th>
                <th>状态</th>
                <th>基准来源</th>
                <th className="num">行数</th>
                <th className="num">差异 / 未处理</th>
                <th className="num">差额合计</th>
                <th>匹配时间</th>
              </tr>
            </thead>
            <tbody>
              {statements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无对账单
                  </td>
                </tr>
              ) : (
                statements.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link className="mono" href={`/reconciliation/${s.id}`}>
                        {s.code}
                      </Link>
                    </td>
                    <td className="small">{nameOf(s)}</td>
                    <td>
                      <Badge tone={STATUS_LABEL[s.status]?.tone ?? "gray"}>
                        {STATUS_LABEL[s.status]?.text ?? s.status}
                      </Badge>
                    </td>
                    <td className="small muted">
                      {s.baselineSource === "DERIVED" ? "本系统派生" : "ERP 明细上传"}
                    </td>
                    <td className="num">{s.lineCount}</td>
                    <td className="num">
                      {s.diffLines} / <b>{s.unresolved}</b>
                    </td>
                    <td className="num">
                      {s.currency} {s.diffTotal}
                    </td>
                    <td className="small muted">{s.matchedAt?.slice(0, 10) ?? "—"}</td>
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
