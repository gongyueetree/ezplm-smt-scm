import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { MpnLink } from "@/components/ui/mpn-link";
import { PageHeader } from "@/components/ui/page-header";
import { canAccessKind } from "@/lib/server/recon-access";
import { getStatement } from "@/lib/server/repositories/reconciliation";
import { getSession } from "@/lib/server/session";
import { MatchPanel } from "./match-panel";

export const dynamic = "force-dynamic";

const VERDICT_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  一致: "green",
  数量差异: "red",
  单价差异: "red",
  金额差异: "red",
  币种不一致: "red",
  仅对方有: "amber",
  仅我方有: "amber",
};

export default async function StatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = (await getSession())!;
  const { id } = await params;
  const st = await getStatement(session, id);
  if (!st) notFound();
  if (!canAccessKind(session.roles, st.kind)) {
    return (
      <div>
        <PageHeader path="/reconciliation" />
        <Banner tone="warn">
          <span>
            无权查看该对账单:<b>应收(AR)属 PM 侧,应付(AP)属采购侧</b>。
          </span>
        </Banner>
      </div>
    );
  }

  return (
    <div>
      <PageHeader path="/reconciliation" />

      <Card
        title={st.code}
        sub={`${st.kind === "AR" ? "应收(对客户)" : "应付(对供应商)"} · ${st.currency} · 容差 ${st.amountTolerance}`}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone={st.status === "DRAFT" ? "gray" : "blue"}>{st.status}</Badge>
          <Badge tone="gray">
            基准:{st.baselineSource === "DERIVED" ? "本系统已批准单据派生" : "ERP 导出明细上传"}
          </Badge>
          {st.matchedAt ? <Badge tone="blue">匹配于 {st.matchedAt.slice(0, 10)}</Badge> : null}
          {st.unresolved > 0 ? <Badge tone="red">未处理差异 {st.unresolved}</Badge> : null}
        </div>
        {st.lastPreviewAt ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            最近导出预览:{st.lastPreviewAt.slice(0, 16).replace("T", " ")} ——
            <b>该记录只表示生成过附件,系统未发送任何邮件</b>。
          </p>
        ) : null}
      </Card>

      <MatchPanel
        statementId={st.id}
        kind={st.kind}
        currency={st.currency}
        hasLines={st.lines.length > 0}
      />

      {st.lines.length > 0 ? (
        <>
          <Card title="账龄分析" sub={`按对方对账单金额计 · ${st.aging.currency}`} flush>
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>账龄区间</th>
                    <th className="num">行数</th>
                    <th className="num">金额</th>
                  </tr>
                </thead>
                <tbody>
                  {st.aging.buckets.map((b) => (
                    <tr key={b.bucket} className={b.bucket === "90+" && b.count > 0 ? undefined : undefined}>
                      <td>
                        {b.bucket}
                        {b.bucket === "到期日未知" && b.count > 0 ? (
                          <div className="small" style={{ color: "var(--danger)" }}>
                            账龄不可知 —— 未并入 0–30 天
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{b.count}</td>
                      <td className="num">{b.amount}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <b>逾期合计</b>
                    </td>
                    <td className="num" />
                    <td className="num">
                      <b>{st.aging.overdueTotal}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ padding: "8px 16px" }}>
              「未到期」单列,不是账龄 0;「到期日未知」单列,<b>绝不并入 0–30 天</b> ——
              否则一笔可能已逾期很久的款项会显示得最健康。
            </p>
          </Card>

          <Card
            title="对账明细与差异"
            sub={`${st.lines.length} 行 · 未处理 ${st.unresolved} 行`}
            flush
          >
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>行</th>
                    <th>单据 / MPN</th>
                    <th className="num">对方 数量×单价=金额</th>
                    <th className="num">我方 数量×单价=金额</th>
                    <th className="num">差额</th>
                    <th>判定与依据</th>
                    <th>到期日</th>
                    <th>处理</th>
                  </tr>
                </thead>
                <tbody>
                  {st.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.lineNo}</td>
                      <td className="small">
                        <div className="mono">{l.docNo ?? "—"}{l.docLineNo !== null ? `#${l.docLineNo}` : ""}</div>
                        {l.mpn ? <MpnLink mpn={l.mpn} /> : null}
                      </td>
                      <td className="num small">
                        {l.theirQty ?? "—"} × {l.theirUnitPrice ?? "—"} ={" "}
                        <b>{l.theirAmount ?? "—"}</b>
                        <div className="muted">{l.theirCurrency ?? ""}</div>
                      </td>
                      <td className="num small">
                        {l.ourQty ?? "—"} × {l.ourUnitPrice ?? "—"} = <b>{l.ourAmount ?? "—"}</b>
                        <div className="muted">{l.ourCurrency ?? ""}</div>
                      </td>
                      <td
                        className="num"
                        style={l.severity === "error" ? { color: "var(--danger)" } : undefined}
                      >
                        {l.diffAmount ?? "不可比"}
                      </td>
                      <td className="small">
                        <Badge tone={VERDICT_TONE[l.verdict] ?? "gray"}>{l.verdict}</Badge>
                        {l.details.map((d, i) => (
                          <div key={i} className="muted">
                            {d}
                          </div>
                        ))}
                      </td>
                      <td className="small muted">{l.dueDate?.slice(0, 10) ?? "未知"}</td>
                      <td className="small">
                        {l.resolution ? (
                          <>
                            <Badge tone="green">{l.resolution}</Badge>
                            {l.resolutionNote ? <div className="muted">{l.resolutionNote}</div> : null}
                          </>
                        ) : l.verdict === "一致" ? (
                          <span className="muted">—</span>
                        ) : (
                          <span style={{ color: "var(--danger)" }}>待处理</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
