"use client";

import { useState } from "react";
import { AlternateResultCard, type ScoredResult } from "@/components/alternates/result-card";
import { useAlternateSelections } from "@/components/alternates/use-selections";
import { Badge } from "@/components/ui/badge";
import { MODE_LABELS, type SubstitutionMode } from "@/lib/domain/alternate-score";

interface Constraint {
  key: string;
  label: string;
  required: string | null;
  higherIsBetter?: boolean;
}

interface Subject {
  mpn: string;
  manufacturer: string | null;
  description: string | null;
  lifecycle?: string | null;
  footprint?: string | null;
  localHit?: boolean;
  category?: string | null;
}

const MODES: SubstitutionMode[] = [
  "PIN_TO_PIN",
  "PACKAGE_COMPATIBLE",
  "FUNCTIONAL",
  "DOMESTIC",
  "LOW_COST",
];

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
  const [results, setResults] = useState<ScoredResult[] | null>(null);
  const [degraded, setDegraded] = useState<{ provider: string; kind: string }[]>([]);
  const [includeMarket, setIncludeMarket] = useState(true);
  const [demandQty, setDemandQty] = useState(100);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // 勾选清单跟着"当前分析过的型号"走 —— 输入框里边打字边换清单会闪
  const [selectionSubject, setSelectionSubject] = useState<string | null>(null);
  const sel = useAlternateSelections(selectionSubject, []);

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
        body: JSON.stringify({
          mode,
          constraints,
          preferredManufacturers: vendors,
          includeMarket,
          demandQty,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `分析失败(HTTP ${res.status})`);
        return;
      }
      setResults(body.results ?? []);
      setSelectionSubject(body.subject?.mpn ?? q);
      setSubject((prev) => ({
        ...(prev ?? { mpn: q, manufacturer: null, description: null }),
        ...body.subject,
      }));
      setDegraded(body.degraded ?? []);
    } finally {
      setBusy(false);
    }
  }

  /** 拖拽重排;↑↓ 按钮保留为键盘可达的等价操作 */
  function reorder(from: number, to: number) {
    setConstraints((prev) => {
      if (from === to || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
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
              {subject.category ? (
                <div style={{ marginBottom: 4 }}>
                  <Badge tone="green">{subject.category}</Badge>
                </div>
              ) : null}
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
              顺序即权重,越靠前越重要;<b>可直接拖拽</b>,或用 ↑↓ 调整
            </p>
            {constraints.map((c, i) => (
              <div
                key={c.key}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null) reorder(dragIndex, i);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  padding: "5px 0",
                  borderBottom: "1px solid var(--gray-100)",
                  cursor: "grab",
                  opacity: dragIndex === i ? 0.45 : 1,
                }}
              >
                <span className="muted" aria-hidden="true">
                  ⠿
                </span>
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
          <p className="small muted" style={{ marginTop: 6 }} data-testid="mode-desc">
            {MODE_LABELS[mode].desc}
          </p>

          <div className="divider" style={{ margin: "10px 0" }} />
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={includeMarket}
              onChange={(e) => setIncludeMarket(e.target.checked)}
            />
            <span className="small">查询市场行情</span>
          </label>
          <p className="small muted" style={{ margin: "4px 0 8px" }}>
            只对<b>最终入选的 Top 5</b> 调 DigiKey / Mouser(会消耗配额,结果按 15 分钟缓存)
          </p>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>询价数量(决定供货档位基准)</span>
            <input
              type="number"
              min={1}
              value={demandQty}
              onChange={(e) => setDemandQty(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>

        <button className="btn primary" onClick={() => void run()} disabled={busy || !mpn.trim()}>
          {busy ? "分析中…" : "开始替代分析"}
        </button>
      </div>

      {/* 右栏:结果 */}
      <div data-testid="alt-results" style={{ flex: "1 1 520px", minWidth: 340 }}>
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
          <>
            <p className="small muted" style={{ marginBottom: 8 }}>
              勾选「选用」即把该候选存入<b>该型号的候选清单</b>(物料详情页「⑦ 替代料」可见);
              勾选<b>不代表替代关系已成立</b>。
            </p>
            {sel.error ? <div className="banner warn">{sel.error}</div> : null}
            {results.map((r, i) => (
              <AlternateResultCard
                key={r.mpn}
                result={r}
                rank={i + 1}
                marketRequested={includeMarket}
                selected={sel.isSelected(r.mpn)}
                selectBusy={sel.busyMpn === r.mpn}
                onToggleSelect={(next) => void sel.toggle(r, mode, next)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
