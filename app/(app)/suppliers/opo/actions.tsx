"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/card";

interface OpoLineRow {
  id: string;
  poNo: string;
  lineNo: number;
  mpn: string | null;
  qtyOpen: number;
  promiseDate: string | null;
  needDate: string | null;
  replyEta: string | null;
  replyQty: number | null;
  replySource: string | null;
}

export function OpoActions({ lines }: { lines: OpoLineRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function reply(line: OpoLineRow) {
    const eta = window.prompt(`${line.poNo}-${line.lineNo} 供应商回复 ETA(YYYY-MM-DD):`);
    if (eta === null) return;
    const qty = window.prompt("回复数量:", String(line.qtyOpen));
    if (qty === null) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/opo/lines/${line.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replyEta: eta.trim() ? new Date(`${eta.trim()}T00:00:00.000Z`).toISOString() : null,
          replyQty: qty.trim() ? Number(qty) : null,
          replyNote: null,
          replySource: "MANUAL",
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "记录回复失败");
        return;
      }
      setInfo("已记录回复;KPI 与各表已按同一份数据重新派生");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error ? (
        <div className="banner warn" role="alert">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="banner info" role="status">
          {info}
        </div>
      ) : null}

      <Card title="OPO 行" sub={`${lines.length} 行 · 行级模型为唯一数据源`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>PO</th>
                <th className="num">行</th>
                <th>MPN</th>
                <th className="num">未交量</th>
                <th>需求日期</th>
                <th>ERP 承诺</th>
                <th>回复 ETA / 数量 / 来源</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无 OPO 行(可由采购订单同步或 ERP 导入产生)
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.id}>
                    <td className="mono small">{l.poNo}</td>
                    <td className="num">{l.lineNo}</td>
                    <td className="mono small">{l.mpn ?? "-"}</td>
                    <td className="num">{l.qtyOpen}</td>
                    <td className="small">{l.needDate?.slice(0, 10) ?? "-"}</td>
                    <td className="small">{l.promiseDate?.slice(0, 10) ?? "-"}</td>
                    <td className="small">
                      {l.replyEta ? (
                        <>
                          {l.replyEta.slice(0, 10)} / {l.replyQty ?? "-"} / {l.replySource}
                        </>
                      ) : (
                        <span className="muted">未回复</span>
                      )}
                    </td>
                    <td>
                      <button className="btn xs" disabled={busy} onClick={() => reply(l)}>
                        记录回复
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="ERP 交期回写" sub="API 不可回写时的替代路径(SPEC §14)">
        <a className="btn" href="/api/opo/erp-export">
          导出 ERP 导入模板(XLSX)
        </a>
        <p className="small muted" style={{ marginTop: 8 }}>
          生成即登记 IntegrationJob(幂等键防重复);<b>RPA / API 直写属二期</b>,
          当前交付的是「系统生成 ERP 可导入模板 + 导入回执登记」。
        </p>
      </Card>
    </div>
  );
}
