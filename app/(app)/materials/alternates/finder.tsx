"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { MpnLink } from "@/components/ui/mpn-link";
import { MODE_LABELS, SOURCE_LABELS, type SubstitutionMode } from "@/lib/domain/alternate-score";

interface Constraint {
  key: string;
  label: string;
  required: string | null;
  higherIsBetter?: boolean;
}

interface ParamRow {
  key: string;
  label: string;
  actual: string | null;
  source: keyof typeof SOURCE_LABELS;
  score: number | null;
  verdict: string;
  detail: string;
}

interface Scored {
  mpn: string;
  manufacturer: string | null;
  description: string | null;
  technical: number;
  evidence: number;
  sourceTrust: number;
  confidence: number;
  rows: ParamRow[];
  warnings: string[];
  modeTag: string;
  preferredVendor: boolean;
}

interface Subject {
  mpn: string;
  manufacturer: string | null;
  description: string | null;
  lifecycle?: string | null;
  footprint?: string | null;
  localHit?: boolean;
}

const MODES: SubstitutionMode[] = [
  "PIN_TO_PIN",
  "PACKAGE_COMPATIBLE",
  "FUNCTIONAL",
  "DOMESTIC",
  "LOW_COST",
];

const VERDICT_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  一致: "green",
  更优: "green",
  部分覆盖: "amber",
  有差异: "red",
  缺失: "gray",
  未知: "gray",
};

/** 评分环:纯 SVG,不引图表库(离线部署禁 CDN) */
function ScoreRing({ value }: { value: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const tone = value >= 80 ? "var(--brand)" : value >= 60 ? "#b58105" : "var(--danger)";
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" role="img" aria-label={`结论可信 ${value}`}>
      <circle cx="23" cy="23" r={r} fill="none" stroke="var(--gray-200)" strokeWidth="4" />
      <circle
        cx="23"
        cy="23"
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth="4"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 23 23)"
      />
      <text x="23" y="27" textAnchor="middle" fontSize="13" fontWeight="700" fill={tone}>
        {value}
      </text>
    </svg>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div
      style={{
        flex: "1 1 110px",
        border: "1px solid var(--gray-200)",
        borderRadius: 8,
        padding: "8px 10px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 700 }}>{value}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}

export function AlternateFinder({ initialMpn }: { initialMpn: string }) {
  const [mpn, setMpn] = useState(initialMpn);
  const [loadingSpec, setLoadingSpec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [mode, setMode] = useState<SubstitutionMode>("FUNCTIONAL");
  const [vendors, setVendors] = useState<string[]>([]);
  const [vendorInput, setVendorInput] = useState("");
  const [results, setResults] = useState<Scored[] | null>(null);
  const [degraded, setDegraded] = useState<{ provider: string; kind: string }[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function loadSpec() {
    const q = mpn.trim();
    if (!q) return;
    setLoadingSpec(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/materials/${encodeURIComponent(q)}/alternates`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `取规格失败(HTTP ${res.status})`);
        return;
      }
      setSubject(body.subject);
      setConstraints(body.constraints ?? []);
      setDegraded(body.degraded ?? []);
    } finally {
      setLoadingSpec(false);
    }
  }

  async function run() {
    const q = mpn.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/materials/${encodeURIComponent(q)}/alternates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, constraints, preferredManufacturers: vendors }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `分析失败(HTTP ${res.status})`);
        return;
      }
      setResults(body.results ?? []);
      setSubject((prev) => ({
        ...(prev ?? { mpn: q, manufacturer: null, description: null }),
        ...body.subject,
      }));
      setDegraded(body.degraded ?? []);
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: number) {
    setConstraints((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* 左栏:输入与约束 */}
      <div
        style={{
          flex: "0 0 340px",
          minWidth: 300,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div className="card" style={{ padding: 14 }}>
          <label className="fld" style={{ marginBottom: 8 }}>
            <span>待查型号</span>
            <input
              value={mpn}
              onChange={(e) => setMpn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadSpec();
              }}
              placeholder="如 STM32F103C8T6"
            />
          </label>
          <button
            className="btn"
            onClick={() => void loadSpec()}
            disabled={loadingSpec || !mpn.trim()}
          >
            {loadingSpec ? "读取规格中…" : "读取规格与参数"}
          </button>

          {subject ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <b className="mono">{subject.mpn}</b>
                {subject.localHit ? <Badge tone="amber">本地库命中</Badge> : null}
              </div>
              <div className="small muted">{subject.manufacturer ?? "制造商未知"}</div>
              <div className="small muted">{subject.description ?? "无描述"}</div>
            </div>
          ) : null}
        </div>

        <div className="card" style={{ padding: 14 }}>
          <b className="small">优选厂商</b>
          <p className="small muted" style={{ margin: "4px 0 8px" }}>
            添加后<b>同分</b>候选优先推荐;<b>不改变技术评分</b>
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="input-xs"
              placeholder="输入厂商名称…"
              aria-label="优选厂商"
              value={vendorInput}
              onChange={(e) => setVendorInput(e.target.value)}
            />
            <button
              className="btn sm"
              onClick={() => {
                const v = vendorInput.trim();
                if (v && !vendors.includes(v)) setVendors([...vendors, v]);
                setVendorInput("");
              }}
            >
              添加
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {vendors.map((v) => (
              <button
                key={v}
                className="btn xs"
                onClick={() => setVendors(vendors.filter((x) => x !== v))}
              >
                {v} ✕
              </button>
            ))}
          </div>
        </div>

        {constraints.length > 0 ? (
          <div className="card" style={{ padding: 14 }}>
            <b className="small">参数优先级与范围</b>
            <p className="small muted" style={{ margin: "4px 0 8px" }}>
              顺序即权重,越靠前越重要;用 ↑↓ 调整
            </p>
            {constraints.map((c, i) => (
              <div
                key={c.key}
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  padding: "5px 0",
                  borderBottom: "1px solid var(--gray-100)",
                }}
              >
                <Badge tone="green">{i + 1}</Badge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600 }}>
                    {c.label}
                  </div>
                  <div className="small muted mono" style={{ wordBreak: "break-all" }}>
                    {c.required ?? "—"}
                  </div>
                </div>
                <button className="btn xs" onClick={() => move(i, -1)} aria-label={`上移 ${c.label}`}>
                  ↑
                </button>
                <button className="btn xs" onClick={() => move(i, 1)} aria-label={`下移 ${c.label}`}>
                  ↓
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="card" style={{ padding: 14 }}>
          <b className="small">替代模式</b>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {MODES.map((m) => (
              <button
                key={m}
                className={`btn sm${mode === m ? " primary" : ""}`}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
              >
                {MODE_LABELS[m].title}
              </button>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            {MODE_LABELS[mode].desc}
          </p>
        </div>

        <button className="btn primary" onClick={() => void run()} disabled={busy || !mpn.trim()}>
          {busy ? "分析中…" : "开始替代分析"}
        </button>
      </div>

      {/* 右栏:结果 */}
      <div style={{ flex: "1 1 520px", minWidth: 340 }}>
        {error ? <div className="banner warn">{error}</div> : null}
        {degraded.length > 0 ? (
          <div className="banner warn">
            外部数据源降级(已展示可用部分):
            {degraded.map((d, i) => (
              <span key={i}>
                {" "}
                {d.provider}/{d.kind}
              </span>
            ))}
          </div>
        ) : null}

        {results === null ? (
          <div className="card" style={{ padding: 28, textAlign: "center" }}>
            <p className="small muted">先读取规格,调整参数优先级与替代模式,再点「开始替代分析」。</p>
            <p className="small muted">
              流程:汇集候选(本地库 / ezPLM / DigiKey)→ 逐项参数比对 → 四维评分 → 输出 Top 5
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="card" style={{ padding: 28, textAlign: "center" }}>
            <p className="small muted">未找到够格的替代候选 —— 与其列一堆无关型号,不如如实说没有。</p>
          </div>
        ) : (
          results.map((r, i) => (
            <div className="card" key={r.mpn} style={{ padding: 14, marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Badge tone="gray">#{i + 1}</Badge>
                <ScoreRing value={r.confidence} />
                <Badge tone={r.modeTag.startsWith("[P2]") ? "green" : "amber"}>{r.modeTag}</Badge>
                <MpnLink mpn={r.mpn} />
                {r.preferredVendor ? <Badge tone="purple">优选厂商</Badge> : null}
                <button
                  className="btn xs"
                  style={{ marginLeft: "auto" }}
                  onClick={() => setExpanded((p) => ({ ...p, [r.mpn]: !p[r.mpn] }))}
                >
                  {expanded[r.mpn] ? "收起参数对比" : "参数对比详情"}
                </button>
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {r.manufacturer ?? "制造商未知"} · {r.description ?? "无描述"}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <Metric value={r.technical} label="技术兼容" />
                <Metric value={r.evidence} label="证据覆盖" />
                <Metric value={r.sourceTrust} label="来源可信" />
                <Metric value={r.confidence} label="结论可信" />
              </div>

              {r.warnings.map((w, k) => (
                <div className="banner warn" key={k} style={{ marginTop: 8 }}>
                  ⚠ {w}
                </div>
              ))}

              {expanded[r.mpn] ? (
                <div className="tbl-scroll" style={{ marginTop: 10 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>参数</th>
                        <th>候选值</th>
                        <th className="num">分数</th>
                        <th>判定</th>
                        <th>数据来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.rows.map((row) => (
                        <tr key={row.key}>
                          <td className="small">{row.label}</td>
                          <td className="small mono">{row.actual ?? "—"}</td>
                          <td className="num small">{row.score ?? "—"}</td>
                          <td className="small">
                            <Badge tone={VERDICT_TONE[row.verdict] ?? "gray"}>{row.verdict}</Badge>
                            <div className="muted">{row.detail}</div>
                          </td>
                          <td className="small">
                            <Badge tone={row.source === "AI_SEARCH" ? "amber" : "blue"}>
                              {SOURCE_LABELS[row.source]}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
