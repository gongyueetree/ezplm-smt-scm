"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { MpnLink } from "@/components/ui/mpn-link";

interface Ranked {
  candidate: {
    mpn: string;
    manufacturer: string | null;
    origin: string;
    lifecycle: string | null;
    stock: number | null;
    unitPrice: string | null;
    currency: string | null;
    footprintMatches: boolean | null;
  };
  score: number;
  reasons: string[];
  readyToOrder: boolean;
}

const ORIGIN_LABEL: Record<string, { text: string; tone: "green" | "blue" | "purple" }> = {
  LOCAL: { text: "本系统物料库", tone: "green" },
  EZPLM: { text: "ezPLM", tone: "blue" },
  DIGIKEY: { text: "DigiKey", tone: "purple" },
  MOUSER: { text: "Mouser", tone: "purple" },
};

/**
 * 替代料查询工具:对**任意型号**跑一次替代分析。
 * 结果只是候选,是否可替代必须由工程按参数/封装/合规逐项确认。
 */
export function AlternateFinder({ initialMpn }: { initialMpn: string }) {
  const [mpn, setMpn] = useState(initialMpn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  const [rows, setRows] = useState<Ranked[]>([]);
  const [subject, setSubject] = useState<{ footprint: string | null; lifecycle: string | null } | null>(null);
  const [degraded, setDegraded] = useState<{ provider: string; kind: string; message: string }[]>([]);

  async function run() {
    const q = mpn.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/materials/${encodeURIComponent(q)}/alternates`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `查询失败(HTTP ${res.status})`);
        return;
      }
      setRows(body.alternates ?? []);
      setSubject(body.subject ?? null);
      setDegraded(body.degraded ?? []);
      setRan(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input-xs"
          style={{ width: 280 }}
          placeholder="输入任意厂商型号,如 MIC5504-3.3YM5-TR"
          aria-label="待查型号"
          value={mpn}
          onChange={(e) => setMpn(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
        />
        <button className="btn primary" onClick={() => void run()} disabled={busy || !mpn.trim()}>
          {busy ? "分析中…" : "查找替代料"}
        </button>
      </div>

      {error ? (
        <p className="small" style={{ marginTop: 10, color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}

      {degraded.length > 0 ? (
        <p className="small" style={{ marginTop: 8, color: "var(--warn, #b54708)" }}>
          外部数据源降级(已展示可用部分):
          {degraded.map((d, i) => (
            <span key={i}>
              {" "}
              {d.provider}/{d.kind}
            </span>
          ))}
        </p>
      ) : null}

      {ran ? (
        <div style={{ marginTop: 12 }}>
          {subject ? (
            <p className="small muted">
              被替代件:封装 <b>{subject.footprint ?? "未知"}</b> · 生命周期{" "}
              <b>{subject.lifecycle ?? "未知"}</b>
            </p>
          ) : null}
          <div className="tbl-scroll" style={{ marginTop: 8 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>候选型号</th>
                  <th>制造商</th>
                  <th>判断依据</th>
                  <th>来源 / 评分</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                      未找到够格的替代候选 —— 与其列一堆无关型号,不如如实说没有
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={`${r.candidate.mpn}-${i}`}>
                      <td>
                        <MpnLink mpn={r.candidate.mpn} />
                        {r.readyToOrder ? (
                          <div>
                            <Badge tone="green">可直接下单</Badge>
                          </div>
                        ) : null}
                      </td>
                      <td className="small">{r.candidate.manufacturer ?? "-"}</td>
                      <td className="small muted">{r.reasons.join(" · ")}</td>
                      <td>
                        <Badge tone={ORIGIN_LABEL[r.candidate.origin]?.tone ?? "gray"}>
                          {ORIGIN_LABEL[r.candidate.origin]?.text ?? r.candidate.origin}
                        </Badge>
                        <div className="small muted">评分 {(r.score * 100).toFixed(0)}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
