import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getOpoDashboard } from "@/lib/server/repositories/opo";
import { getSession } from "@/lib/server/session";
import { OpoActions } from "./actions";
import { MpnLink } from "@/components/ui/mpn-link";

export const dynamic = "force-dynamic";

export default async function OpoPage() {
  const session = (await getSession())!;
  const now = new Date().toISOString();
  const { lines, kpi, noReply, diffs, anomalies, scopeNotice } = await getOpoDashboard(session, now);

  return (
    <div>
      <PageHeader path="/suppliers/opo" />
      {scopeNotice ? (
        <Banner tone="warn">
          <span data-testid="opo-scope-notice">{scopeNotice}</span>
        </Banner>
      ) : null}
      <Banner tone="soft">
        <span>
          KPI、未回复表、差异表、异常清单<b>全部由同一份 OPOLine 行数据派生</b>,
          系统不保存任何冗余计数。催办为<b>提前 {4} 天</b>扫描并生成记录,
          <b>邮件发送为预览/模拟,尚未接入真实邮件通道</b>。
        </span>
      </Banner>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">OPO 行数</div>
          <div className="kpi-value">{kpi.totalLines}</div>
        </div>
        <div className="kpi warn">
          <div className="kpi-label">未回复</div>
          <div className="kpi-value">{kpi.noReplyLines}</div>
          <div className="kpi-foot">回复率 {(kpi.replyRate * 100).toFixed(1)}%</div>
        </div>
        <div className="kpi danger">
          <div className="kpi-label">异常行(error)</div>
          <div className="kpi-value">{kpi.errorLines}</div>
        </div>
        <div className="kpi warn">
          <div className="kpi-label">提示行(warning)</div>
          <div className="kpi-value">{kpi.warningLines}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">正常行</div>
          <div className="kpi-value">{kpi.healthyLines}</div>
          <div className="kpi-foot">三类互斥,合计 = 总行数</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">未交总量</div>
          <div className="kpi-value">{kpi.totalOpenQty}</div>
        </div>
      </div>

      <OpoActions
        lines={lines.map((l) => ({
          id: l.id,
          poNo: l.poNo,
          lineNo: l.lineNo,
          mpn: l.mpn,
          qtyOpen: l.qtyOpen,
          promiseDate: l.promiseDate,
          needDate: l.needDate,
          replyEta: l.latestReply?.replyEta ?? null,
          replyQty: l.latestReply?.replyQty ?? null,
          replySource: l.latestReply?.replySource ?? null,
        }))}
      />

      <Card title="未回复供应商" sub={`${noReply.length} 行(派生)`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>PO</th>
                <th className="num">行</th>
                <th>MPN</th>
                <th className="num">未交量</th>
                <th>ERP 承诺</th>
              </tr>
            </thead>
            <tbody>
              {noReply.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                    全部已回复
                  </td>
                </tr>
              ) : (
                noReply.map((l) => (
                  <tr key={l.id}>
                    <td className="mono small">{l.poNo}</td>
                    <td className="num">{l.lineNo}</td>
                    <td className="small">
                      <MpnLink mpn={l.mpn} />
                    </td>
                    <td className="num">{l.qtyOpen}</td>
                    <td className="small">{l.promiseDate?.slice(0, 10) ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="交期/数量差异" sub={`${diffs.length} 行(派生)`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>PO</th>
                <th className="num">行</th>
                <th>ERP 承诺</th>
                <th>回复 ETA</th>
                <th className="num">交期差(天)</th>
                <th className="num">数量差</th>
              </tr>
            </thead>
            <tbody>
              {diffs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                    无差异
                  </td>
                </tr>
              ) : (
                diffs.map((d) => (
                  <tr key={d.line.id} className={(d.deltaDays ?? 0) > 0 ? "row-warn" : undefined}>
                    <td className="mono small">{d.line.poNo}</td>
                    <td className="num">{d.line.lineNo}</td>
                    <td className="small">{d.promiseDate?.slice(0, 10) ?? "-"}</td>
                    <td className="small">{d.replyEta?.slice(0, 10) ?? "-"}</td>
                    <td className="num">{d.deltaDays ?? "-"}</td>
                    <td className="num">{d.qtyDelta ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="异常清单" sub={`${anomalies.length} 行(派生)`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>PO</th>
                <th className="num">行</th>
                <th>异常</th>
              </tr>
            </thead>
            <tbody>
              {anomalies.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                    无异常
                  </td>
                </tr>
              ) : (
                anomalies.map((a) => (
                  <tr key={a.line.id}>
                    <td className="mono small">{a.line.poNo}</td>
                    <td className="num">{a.line.lineNo}</td>
                    <td className="small">
                      {a.anomalies.map((x, i) => (
                        <div key={i}>
                          <Badge tone={x.level === "error" ? "red" : "amber"}>{x.code}</Badge>{" "}
                          {x.message}
                        </div>
                      ))}
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
