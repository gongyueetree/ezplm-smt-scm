"use client";

/**
 * 批量 update 报价(客户 xlsx 新增需求)。
 *
 * 语义是 **update**:该 BOM 所属 RFQ+客户已有报价 → 开**新 Revision**;
 * 没有才新建。逐 BOM 独立成败,失败逐条列出原因,不用一个整体状态掩盖细节。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface ItemResult {
  bomVersionId: string;
  bomName: string;
  ok: boolean;
  mode: "NEW" | "REVISION" | null;
  quoteVersionId: string | null;
  lines: number;
  missingCost: number;
  reason: string | null;
}

export function BatchUpdateQuotes({
  bomVersions,
}: {
  bomVersions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ItemResult[] | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quotes/batch-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bomVersionIds: selected }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `批量生成失败(HTTP ${res.status})`);
        return;
      }
      setResults(body.results ?? []);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Card title="批量 update 报价" sub="选多个 BOM 版本,逐个生成/更新报价单">
        <button className="btn" onClick={() => setOpen(true)}>
          批量 update 报价
        </button>
      </Card>
    );
  }

  return (
    <Card title="批量 update 报价" sub="已有报价的 BOM 开新 Revision;没有的才新建">
      <p className="small muted">
        逐 BOM 独立处理:<b>一条失败不影响其它</b>,失败原因逐条列出。
        生成的报价行只取<b>已人工确认</b>的匹配行,采购成本取不到时留空(系统不臆造成本)。
      </p>
      <div
        style={{
          maxHeight: 220,
          overflow: "auto",
          border: "1px solid var(--gray-200)",
          borderRadius: 8,
          padding: 8,
          margin: "10px 0",
        }}
      >
        {bomVersions.length === 0 ? (
          <p className="small muted">暂无 BOM 版本</p>
        ) : (
          bomVersions.map((v) => (
            <label key={v.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: 2 }}>
              <input
                type="checkbox"
                checked={selected.includes(v.id)}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked ? [...prev, v.id] : prev.filter((x) => x !== v.id),
                  )
                }
              />
              <span className="small">{v.label}</span>
            </label>
          ))
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn primary"
          disabled={busy || selected.length === 0}
          onClick={() => void run()}
        >
          {busy ? "处理中…" : `生成 / 更新 ${selected.length} 个报价`}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>

      {error ? (
        <div className="banner warn" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      {results ? (
        <div className="tbl-scroll" style={{ marginTop: 12 }} data-testid="batch-update-results">
          <table className="tbl">
            <thead>
              <tr>
                <th>BOM</th>
                <th>方式</th>
                <th className="num">报价行</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.bomVersionId}>
                  <td className="small">{r.bomName}</td>
                  <td>
                    {r.mode === "REVISION" ? (
                      <Badge tone="blue">新 Revision</Badge>
                    ) : r.mode === "NEW" ? (
                      <Badge tone="green">新建报价</Badge>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">{r.lines}</td>
                  <td className="small">
                    {r.ok ? (
                      <>
                        <Badge tone="green">成功</Badge>
                        {r.missingCost > 0 ? (
                          <div className="muted">{r.missingCost} 行无采购成本,已留空待人工填</div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Badge tone="red">失败</Badge>
                        <div style={{ color: "var(--danger)" }}>{r.reason}</div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
