"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { MpnLink } from "@/components/ui/mpn-link";

export interface ReviewCandidate {
  id: string;
  source: string;
  confidence: number;
  mpn: string;
  manufacturer: string | null;
  footprint: string | null;
  lifecycle: string | null;
  stockQty: number | null;
  slowMovingQty: number | null;
  opoQty: number | null;
  eta: string | null;
  price: string | null;
  currency: string | null;
  dataUpdatedAt: string | null;
}

export interface ReviewLine {
  /** MPN 来源:inferred-from-value = 由 Value 列推断,须人工确认 */
  mpnSource?: string | null;
  packageCode?: string | null;
  id: string;
  lineNo: number;
  refDes: string | null;
  qty: number;
  mpn: string | null;
  manufacturer: string | null;
  description: string | null;
  footprint: string | null;
  flags: { dupRefDes: boolean; eol: boolean; footprintMismatch: boolean };
  decision: { decision: string; candidateId: string | null } | null;
  candidates: ReviewCandidate[];
}

const LIFECYCLE_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  ACTIVE: "green",
  NRND: "amber",
  EOL: "red",
  OBSOLETE: "red",
  UNKNOWN: "gray",
};

export function MatchReview({ lines }: { lines: ReviewLine[] }) {
  const router = useRouter();
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(lineId: string, decision: string, candidateId?: string) {
    setBusyLine(lineId);
    setError(null);
    try {
      const res = await fetch(`/api/bom/lines/${lineId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, candidateId: candidateId ?? null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "保存确认失败");
        return;
      }
      router.refresh();
    } finally {
      setBusyLine(null);
    }
  }

  return (
    <div>
      {error ? (
        <div className="banner warn" style={{ margin: 16 }} role="alert">
          {error}
        </div>
      ) : null}
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>行</th>
              <th>位号 / 用量</th>
              <th>BOM 原始信息</th>
              <th>候选(来源 · 置信度 · 生命周期 · 库存 · 呆滞 · OPO · ETA · 价格 · 数据更新)</th>
              <th>确认</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr
                key={l.id}
                className={l.flags.eol || l.flags.dupRefDes ? "row-danger" : undefined}
              >
                <td className="num">{l.lineNo}</td>
                <td className="small">
                  {l.refDes ?? "-"}
                  <div className="muted">×{l.qty}</div>
                </td>
                <td className="small">
                  <div>
                    <MpnLink mpn={l.mpn} fallback="(无 MPN)" />
                  </div>
                  <div className="muted">
                    {l.manufacturer ?? "-"} · {l.packageCode ?? l.footprint ?? "-"}
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                    {l.mpnSource === "inferred-from-value" ? (
                      <Badge tone="amber">MPN 由 Value 推断 · 待人工确认</Badge>
                    ) : null}
                    {l.flags.dupRefDes ? <Badge tone="red">位号重复</Badge> : null}
                    {l.flags.eol ? <Badge tone="red">EOL</Badge> : null}
                    {l.flags.footprintMismatch ? <Badge tone="amber">封装不一致</Badge> : null}
                  </div>
                </td>
                <td>
                  {l.candidates.length === 0 ? (
                    <span className="small muted">无候选,需人工指定或标记无匹配</span>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {l.candidates.slice(0, 4).map((c) => {
                        const chosen = l.decision?.candidateId === c.id;
                        return (
                          <div
                            key={c.id}
                            className="small"
                            style={{
                              border: `1px solid ${chosen ? "var(--brand)" : "var(--gray-200)"}`,
                              borderRadius: 8,
                              padding: "6px 8px",
                              background: chosen ? "var(--brand-50)" : "var(--surface)",
                            }}
                          >
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <Badge tone="blue">{c.source}</Badge>
                              <MpnLink mpn={c.mpn} />
                              <span className="muted">{c.manufacturer ?? "-"}</span>
                              <Badge tone={LIFECYCLE_TONE[c.lifecycle ?? "UNKNOWN"] ?? "gray"}>
                                {c.lifecycle ?? "生命周期未知"}
                              </Badge>
                              <span className="muted">置信度 {(c.confidence * 100).toFixed(0)}%</span>
                            </div>
                            <div className="muted" style={{ marginTop: 2 }}>
                              库存 {c.stockQty ?? "未知"} · 呆滞 {c.slowMovingQty ?? "未知"} · OPO{" "}
                              {c.opoQty ?? "未知"} · ETA {c.eta ?? "未知"} · 价格{" "}
                              {c.price ? `${c.currency ?? ""} ${c.price}` : "未知"} · 数据更新{" "}
                              {c.dataUpdatedAt ?? "未知"}
                            </div>
                            <button
                              className="btn xs"
                              style={{ marginTop: 4 }}
                              disabled={busyLine === l.id}
                              onClick={() => decide(l.id, "ACCEPT_CANDIDATE", c.id)}
                            >
                              {chosen ? "✓ 已采纳" : "采纳此候选"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td>
                  {l.decision ? (
                    <Badge tone="green">
                      {l.decision.decision === "NO_MATCH" ? "已标记无匹配" : "已确认"}
                    </Badge>
                  ) : (
                    <Badge tone="gray">待确认</Badge>
                  )}
                  <div style={{ marginTop: 6 }}>
                    <button
                      className="btn xs"
                      disabled={busyLine === l.id}
                      onClick={() => decide(l.id, "NO_MATCH")}
                    >
                      标记无匹配
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
