"use client";

/**
 * 详情页内嵌的替代料查询与勾选。
 *
 * 与独立的「替代料查询」工具用同一套 API 与同一套评分口径,
 * 区别只是这里省掉了参数优先级编辑 —— 详情页要的是"快速看一眼有没有替代",
 * 要精调参数权重就去工具页。
 *
 * 纪律:勾选只是**候选清单**,不写替代关系;查询会打外部接口,故按钮触发而非随页面加载。
 */
import { useState } from "react";
import Link from "next/link";
import {
  AlternateResultCard,
  type ScoredResult,
} from "@/components/alternates/result-card";
import {
  useAlternateSelections,
  type AlternateSelectionView,
} from "@/components/alternates/use-selections";
import { Badge } from "@/components/ui/badge";
import { MpnLink } from "@/components/ui/mpn-link";
import { MODE_LABELS, type SubstitutionMode } from "@/lib/domain/alternate-score";

const MODES: SubstitutionMode[] = [
  "PIN_TO_PIN",
  "PACKAGE_COMPATIBLE",
  "FUNCTIONAL",
  "DOMESTIC",
  "LOW_COST",
];

export function AlternatePicker({
  mpn,
  initialSelections,
}: {
  mpn: string;
  initialSelections: AlternateSelectionView[];
}) {
  const [mode, setMode] = useState<SubstitutionMode>("FUNCTIONAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScoredResult[] | null>(null);
  const [degraded, setDegraded] = useState<{ provider: string; kind: string }[]>([]);
  const [demandQty, setDemandQty] = useState(100);

  const sel = useAlternateSelections(mpn, initialSelections);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/materials/${encodeURIComponent(mpn)}/alternates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, includeMarket: true, demandQty }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `分析失败(HTTP ${res.status})`);
        return;
      }
      setResults(body.results ?? []);
      setDegraded(body.degraded ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "12px 16px 16px" }} data-testid="alt-picker">
      {/* 已勾选的结果:查过一次就一直在这儿,刷新页面也在 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b className="small">已勾选候选</b>
          <Badge tone="amber">待工程确认</Badge>
          <span className="small muted">
            勾选表示人工认为值得跟进,<b>不代表替代关系已成立</b>;用于报价/采购前仍须正式确认。
          </span>
        </div>
        {sel.items.length === 0 ? (
          <p className="small muted" style={{ marginTop: 6 }}>
            尚未勾选任何候选 —— 点下方「查找替代料」跑一次分析,在结果里勾选要保留的型号。
          </p>
        ) : (
          <div className="tbl-scroll" style={{ marginTop: 6 }} data-testid="alt-selected">
            <table className="tbl">
              <thead>
                <tr>
                  <th>替代型号</th>
                  <th>制造商</th>
                  <th className="num">结论可信</th>
                  <th>勾选时的模式与依据</th>
                  <th>勾选时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sel.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <MpnLink mpn={s.alternateMpn} />
                    </td>
                    <td className="small">{s.manufacturer ?? "-"}</td>
                    <td className="num">
                      <b>{s.confidence}</b>
                      <div className="small muted">
                        技术 {s.technical} · 证据 {s.evidence} · 来源 {s.sourceTrust}
                      </div>
                    </td>
                    <td className="small muted">
                      {MODE_LABELS[s.mode as SubstitutionMode]?.title ?? s.mode}
                      {s.reasons.length > 0 ? ` · ${s.reasons.slice(0, 4).join(" · ")}` : ""}
                      {s.warnings.map((w, i) => (
                        <div key={i} style={{ color: "var(--danger)" }}>
                          ⚠ {w}
                        </div>
                      ))}
                    </td>
                    <td className="small muted">{s.selectedAt.slice(0, 16).replace("T", " ")}</td>
                    <td>
                      <button
                        className="btn xs"
                        disabled={sel.busyMpn === s.alternateMpn}
                        onClick={() => void sel.remove(s.alternateMpn)}
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 6 }}>
              上表评分是<b>勾选当时的快照</b>,不随后续算法或行情变化;要看最新结论请重新查询。
            </p>
          </div>
        )}
      </div>

      <div className="divider" style={{ margin: "12px 0" }} />

      {/* 查询入口 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="small">
          <b>替代模式</b>
        </span>
        {MODES.map((m) => (
          <button
            key={m}
            className={`btn xs${mode === m ? " primary" : ""}`}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
          >
            {MODE_LABELS[m].title}
          </button>
        ))}
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <span className="small muted">询价数量</span>
          <input
            className="input-xs"
            style={{ width: 80 }}
            type="number"
            min={1}
            value={demandQty}
            aria-label="询价数量"
            onChange={(e) => setDemandQty(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <button className="btn primary" onClick={() => void run()} disabled={busy}>
          {busy ? "分析中…" : results === null ? "查找替代料" : "重新查询"}
        </button>
        <Link className="btn xs" href={`/materials/alternates?mpn=${encodeURIComponent(mpn)}`}>
          高级:调参数优先级 →
        </Link>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        {MODE_LABELS[mode].desc} · 查询会调用 ezPLM / DigiKey 接口(<b>消耗日配额</b>),故需手动触发。
      </p>

      {error ? (
        <div className="banner warn" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}
      {sel.error ? (
        <div className="banner warn" style={{ marginTop: 10 }}>
          {sel.error}
        </div>
      ) : null}
      {degraded.length > 0 ? (
        <div className="banner warn" style={{ marginTop: 10 }}>
          外部数据源降级(已展示可用部分):
          {degraded.map((d, i) => (
            <span key={i}>
              {" "}
              {d.provider}/{d.kind}
            </span>
          ))}
        </div>
      ) : null}

      {results !== null ? (
        <div style={{ marginTop: 12 }} data-testid="alt-picker-results">
          {results.length === 0 ? (
            <p className="small muted">
              未找到够格的替代候选 —— 与其列一堆无关型号,不如如实说没有。
            </p>
          ) : (
            <>
              <p className="small muted" style={{ marginBottom: 8 }}>
                共 {results.length} 条候选,勾选「选用」即加入上方候选清单(可重复查询)。
              </p>
              {results.map((r, i) => (
                <AlternateResultCard
                  key={r.mpn}
                  result={r}
                  rank={i + 1}
                  marketRequested
                  selected={sel.isSelected(r.mpn)}
                  selectBusy={sel.busyMpn === r.mpn}
                  onToggleSelect={(next) => void sel.toggle(r, mode, next)}
                />
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
