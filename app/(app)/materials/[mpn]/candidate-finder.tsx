"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { MpnLink } from "@/components/ui/mpn-link";

interface Candidate {
  mpn: string;
  manufacturer: string | null;
  description: string | null;
  footprint: string | null;
}

/**
 * 同系列候选替代料检索。
 * 按钮触发而非随页面加载 —— ezPLM 有日调用配额,且这是**候选**不是结论。
 */
export function CandidateFinder({ mpn }: { mpn: string }) {
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState(false);
  const [keyword, setKeyword] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [rows, setRows] = useState<Candidate[]>([]);

  async function run() {
    setBusy(true);
    setDegraded(null);
    try {
      const res = await fetch(`/api/materials/${encodeURIComponent(mpn)}/alternate-candidates`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setDegraded(body?.error ?? "检索失败");
        return;
      }
      setKeyword(body.keyword ?? null);
      setNote(body.note ?? null);
      setRows(body.candidates ?? []);
      if (body.degraded) {
        setDegraded(`${body.degraded.provider}/${body.degraded.kind} — ${body.degraded.message}`);
      }
      setRan(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "12px 16px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? "检索中…" : "检索同系列候选"}
        </button>
        <span className="small muted">
          按型号系列前缀在 ezPLM 检索同系列物料,<b>会消耗 ezPLM 日调用配额</b>,故需手动触发。
        </span>
      </div>

      {degraded ? (
        <p className="small" style={{ marginTop: 10, color: "var(--danger)" }}>
          检索降级:{degraded}
        </p>
      ) : null}

      {ran ? (
        <div style={{ marginTop: 12 }}>
          <p className="small muted">
            {keyword ? (
              <>
                检索关键字 <b className="mono">{keyword}</b> · 命中 {rows.length} 条。
                这些是<b>同系列候选</b>,<b>不是</b>已成立的替代关系;
                是否可替代须由工程按参数、封装、合规逐项人工判定。
              </>
            ) : (
              note
            )}
          </p>
          {rows.length > 0 ? (
            <div className="tbl-scroll" style={{ marginTop: 8 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>候选型号</th>
                    <th>制造商</th>
                    <th>封装</th>
                    <th>描述</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.mpn}>
                      <td>
                        <MpnLink mpn={c.mpn} />
                      </td>
                      <td className="small">{c.manufacturer ?? "-"}</td>
                      <td className="small">{c.footprint ?? "-"}</td>
                      <td className="small muted" title={c.description ?? undefined}>
                        {c.description && c.description.length > 60
                          ? `${c.description.slice(0, 60)}…`
                          : (c.description ?? "-")}
                      </td>
                      <td>
                        <Badge tone="amber">候选 · 待人工判定</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
