"use client";

/**
 * E2:已维护的替代关系 + 客户点名的四种筛选(Q10)。
 *
 * 与上面的「替代料查询」是两件事,页面上必须分清:
 * - 查询 = 系统帮你找候选,结论未定;
 * - 本表 = **已经核过、写下来的结论**,可以拿去用。
 *
 * 混在一起会让人分不清哪些是系统猜的、哪些是工程拍过板的。
 */
import { useCallback, useEffect, useState } from "react";
import {
  FILTER_PRESETS,
  FUNCTIONAL_LABEL,
  PACKAGE_LABEL,
  PIN_LABEL,
  type AlternateFilterPreset,
  type FunctionalEquivalence,
  type PackageCompatibility,
  type PinCompatibility,
} from "@/lib/domain/alternate-compat";

interface Row {
  id: string;
  basePn: string;
  baseMpn: string | null;
  baseMfg: string | null;
  altPn: string;
  altMpn: string | null;
  altMfg: string | null;
  reason: string | null;
  evidenceSource: string | null;
  note: string | null;
}

interface Item {
  item: Row;
  score: number;
  summary: string;
  needsEngineeringReview: boolean;
  /** 三维取值由 API 直接给出 —— 不从结论字符串反解 */
  compat: {
    functional: FunctionalEquivalence;
    packageCompat: PackageCompatibility;
    pin: PinCompatibility;
  } | null;
}

const PRESETS = Object.keys(FILTER_PRESETS) as AlternateFilterPreset[];

export function CompatPanel() {
  const [preset, setPreset] = useState<AlternateFilterPreset | null>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [truncationNote, setTruncationNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (preset) p.set("preset", preset);
      if (q.trim()) p.set("q", q.trim());
      const res = await fetch(`/api/materials/alternates?${p.toString()}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `加载失败(HTTP ${res.status})`);
        return;
      }
      setItems(body.items ?? []);
      setTotal(body.total ?? 0);
      setTruncationNote(body.truncationNote ?? null);
    } finally {
      setBusy(false);
    }
  }, [preset, q]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div data-testid="compat-panel">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <button
          className={`btn sm${preset === null ? " primary" : ""}`}
          onClick={() => setPreset(null)}
        >
          全部
        </button>
        {PRESETS.map((p) => (
          <button
            key={p}
            className={`btn sm${preset === p ? " primary" : ""}`}
            onClick={() => setPreset(p)}
            title={FILTER_PRESETS[p].desc}
            data-testid={`preset-${p}`}
          >
            {FILTER_PRESETS[p].title}
          </button>
        ))}
        <input
          aria-label="搜索料号"
          placeholder="按料号 / MPN 搜索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 200 }}
        />
      </div>

      <p className="small muted" data-testid="preset-desc">
        {preset ? FILTER_PRESETS[preset].desc : "按客户 Q10 的口径分档:功能一致是首要条件,封装与引脚是次级差别。"}
        <br />
        排序<b>以功能一致优先</b> —— 封装一样但功能不同的料根本不是替代料,
        不会因为封装分高就排到前面。<b>「未知」一律不算命中</b>任何筛选:
        不知道不等于符合。
      </p>

      {truncationNote ? (
        <div className="banner warn" data-testid="compat-truncated">
          {truncationNote}
        </div>
      ) : null}
      {error ? (
        <div className="banner warn" role="alert">
          {error}
        </div>
      ) : null}

      <div className="tbl-scroll">
        <table className="tbl" data-testid="compat-table">
          <thead>
            <tr>
              <th>基准料</th>
              <th>替代料</th>
              <th>功能</th>
              <th>封装</th>
              <th>引脚</th>
              <th>结论</th>
              <th>依据</th>
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={7} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                  加载中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                  {total === 0
                    ? "尚未维护任何替代关系"
                    : `共 ${total} 条替代关系,但没有一条符合当前筛选`}
                </td>
              </tr>
            ) : (
              items.map((x) => (
                <tr key={x.item.id}>
                  <td className="small">
                    <b>{x.item.basePn}</b>
                    <div className="muted">
                      {x.item.baseMfg ?? "-"} {x.item.baseMpn ?? ""}
                    </div>
                  </td>
                  <td className="small">
                    <b>{x.item.altPn}</b>
                    <div className="muted">
                      {x.item.altMfg ?? "-"} {x.item.altMpn ?? ""}
                    </div>
                  </td>
                  <td className="small">
                    {FUNCTIONAL_LABEL[x.compat?.functional ?? "UNKNOWN"]}
                  </td>
                  <td className="small">
                    {PACKAGE_LABEL[x.compat?.packageCompat ?? "UNKNOWN"]}
                  </td>
                  <td className="small">{PIN_LABEL[x.compat?.pin ?? "UNKNOWN"]}</td>
                  <td className="small">
                    {x.summary.replace(/\*\*/g, "")}
                    {x.needsEngineeringReview ? (
                      <div>
                        <span className="badge amber">需工程确认</span>
                      </div>
                    ) : (
                      <div>
                        <span className="badge green">可直接换料</span>
                      </div>
                    )}
                  </td>
                  <td className="small muted">
                    {x.item.reason ?? "未填依据"}
                    {x.item.evidenceSource ? <div>来源:{x.item.evidenceSource}</div> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
