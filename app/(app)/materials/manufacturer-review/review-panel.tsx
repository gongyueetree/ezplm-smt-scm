"use client";

/**
 * R4-3:制造商解析评审面板。
 * 每行:原始写法 → 建议(来源/置信度/证据)→ Approve/选择/Reject。
 * 批量批准仅确定性来源(服务端二次把关)。
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface Row {
  rawManufacturer: string;
  mappingCount: number;
  suggestion: {
    canonicalManufacturerId: string | null;
    canonicalManufacturerName: string | null;
    resolution: string;
    confidence: number;
    evidence: string[];
    requiresManualDecision: boolean;
  };
}

interface Canonical {
  id: string;
  canonicalName: string;
  nameZh: string | null;
}

const RESOLUTION_LABEL: Record<string, string> = {
  TENANT_ALIAS: "租户别名",
  GLOBAL_ALIAS: "全局别名",
  CANONICAL_EXACT: "标准名精确",
  MPN_EVIDENCE: "MPN 证据(候选)",
  FUZZY_CANDIDATE: "相似候选",
  MANUFACTURER_CONFLICT: "冲突·人工裁决",
  UNRESOLVED: "未解析",
};

function tone(res: string): "green" | "amber" | "red" | "gray" {
  if (res === "TENANT_ALIAS" || res === "GLOBAL_ALIAS" || res === "CANONICAL_EXACT") return "green";
  if (res === "MPN_EVIDENCE" || res === "FUZZY_CANDIDATE") return "amber";
  if (res === "MANUFACTURER_CONFLICT") return "red";
  return "gray";
}

export function ReviewPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [canonicals, setCanonicals] = useState<Canonical[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/materials/manufacturer-review");
    if (!res.ok) {
      setError(`加载失败(${res.status})`);
      return;
    }
    const body = (await res.json()) as { rows: Row[]; canonicals: Canonical[] };
    setRows(body.rows);
    setCanonicals(body.canonicals);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function post(payload: unknown, tag: string) {
    setBusy(tag);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/materials/manufacturer-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; updatedMappings?: number; approved?: number }
        | null;
      if (!res.ok) {
        setError(body?.error ?? "操作失败");
        return;
      }
      if (body?.updatedMappings !== undefined) setMsg(`已批准,回写映射 ${body.updatedMappings} 条`);
      if (body?.approved !== undefined) setMsg(`批量批准 ${body.approved} 个确定性建议`);
      await reload();
    } finally {
      setBusy(null);
    }
  }

  if (rows === null) return <p className="muted small" style={{ padding: 16 }}>加载中…</p>;

  return (
    <div>
      <div style={{ padding: "8px 16px", display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="btn"
          disabled={busy !== null}
          onClick={() => void post({ action: "bulk-approve", minConfidence: 0.98 }, "bulk")}
          data-testid="mfr-bulk-approve"
        >
          批量批准确定性建议(≥0.98)
        </button>
        {msg ? <span className="small" style={{ color: "#00890b" }} data-testid="mfr-msg">{msg}</span> : null}
        {error ? <span className="small" role="alert" style={{ color: "#c0392b" }}>{error}</span> : null}
        <span className="muted small">待评审 {rows.length} 个原始写法</span>
      </div>
      <div className="tbl-scroll">
        <table className="tbl" data-testid="mfr-review-table">
          <thead>
            <tr>
              <th>原始 MFG</th>
              <th>映射数</th>
              <th>建议</th>
              <th>来源</th>
              <th>置信度</th>
              <th>证据</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                  没有待评审的原始厂商写法
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const sel = chosen[r.rawManufacturer] ?? r.suggestion.canonicalManufacturerId ?? "";
                return (
                  <tr key={r.rawManufacturer} data-testid={`mfr-row-${r.rawManufacturer}`}>
                    <td className="mono small">{r.rawManufacturer}</td>
                    <td className="num">{r.mappingCount}</td>
                    <td className="small">
                      <select
                        value={sel}
                        aria-label={`${r.rawManufacturer} 标准制造商`}
                        onChange={(e) =>
                          setChosen((p) => ({ ...p, [r.rawManufacturer]: e.target.value }))
                        }
                      >
                        <option value="">(选择标准制造商)</option>
                        {canonicals.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.canonicalName}
                            {c.nameZh ? `(${c.nameZh})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Badge tone={tone(r.suggestion.resolution)}>
                        {RESOLUTION_LABEL[r.suggestion.resolution] ?? r.suggestion.resolution}
                      </Badge>
                    </td>
                    <td className="num">
                      {r.suggestion.confidence > 0 ? `${(r.suggestion.confidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="small muted" style={{ maxWidth: 320 }}>
                      {r.suggestion.evidence.join(";")}
                    </td>
                    <td>
                      <button
                        className="btn xs"
                        disabled={busy !== null || !sel}
                        onClick={() =>
                          void post(
                            { action: "approve", rawName: r.rawManufacturer, canonicalRefId: sel, confidence: r.suggestion.confidence || undefined },
                            r.rawManufacturer,
                          )
                        }
                      >
                        批准
                      </button>{" "}
                      <button
                        className="btn xs"
                        disabled={busy !== null}
                        onClick={() => void post({ action: "reject", rawName: r.rawManufacturer }, `rej-${r.rawManufacturer}`)}
                      >
                        拒绝
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
