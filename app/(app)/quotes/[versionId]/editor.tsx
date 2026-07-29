"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MpnLink } from "@/components/ui/mpn-link";
import { CATEGORY_LABELS, type CalculatedLine } from "@/lib/domain/quote-calc";
import type { QuoteStatusValue } from "@/lib/domain/quote-status";

interface EditorLine {
  id: string;
  lineNo: number;
  quotedMpn: string | null;
  category: string;
  materialCategory: string | null;
  categoryConfirmed: boolean;
  qty: string | null;
  purchaseCost: string | null;
  markupPct: string | null;
}

export function QuoteEditor({
  versionId,
  status,
  currency,
  frozen,
  transitions,
  lines,
  summaryLines,
  bomVersions,
  canExport,
}: {
  versionId: string;
  status: QuoteStatusValue;
  currency: string;
  frozen: boolean;
  transitions: { to: QuoteStatusValue; label: string; requiresReason: boolean }[];
  lines: EditorLine[];
  summaryLines: CalculatedLine[];
  bomVersions: { id: string; label: string }[];
  canExport: boolean;
}) {
  const [bomVersionId, setBomVersionId] = useState(bomVersions[0]?.id ?? "");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<number>(0);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const byLineNo = new Map(summaryLines.map((s) => [s.lineNo, s]));

  async function generateFromBom() {
    if (!bomVersionId) {
      setError("请先选择 BOM 版本");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/quotes/${versionId}/from-bom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bomVersionId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "生成失败");
        return;
      }
      setInfo(`已生成 ${body.created} 行${body.note ? `;${body.note}` : ""}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addDemoLine() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${versionId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineNo: lines.length + 1,
          category: "MATERIAL",
          qty: "1000",
          purchaseCost: "0.08",
          markupPct: "0.15",
          quotedMpn: "RC0603FR-0710KL",
          quotedMfg: "Yageo",
          note: "RES 10K 1% 0603",
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "写入失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmCategory(lineId: string, suggested: string | null) {
    const category = window.prompt("确认物料类别:", suggested ?? "阻容感");
    if (category === null || !category.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/lines/${lineId}/confirm-category`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialCategory: category.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "确认失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runAgent() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/quotes/${versionId}/agent`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "智能体运行失败");
        return;
      }
      setAgentMode(body.mode);
      setPendingApprovals(body.pendingApprovals);
      setLastRunId(body.runId);
      setInfo(
        `已生成 ${body.pendingApprovals} 张待确认卡片(未写入任何数据);` +
          `数据源形态:${body.mode === "mock" ? "本地规则建议(未接入模型)" : "Claude"}`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${versionId}/submit`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          body?.unconfirmedLines?.length
            ? `${body.error}(第 ${body.unconfirmedLines.join("、")} 行)`
            : (body?.error ?? "提交失败"),
        );
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "APPROVED" | "REJECTED") {
    let comment: string | null = null;
    if (decision === "REJECTED") {
      comment = window.prompt("退回必须填写原因:");
      if (comment === null) return;
      if (!comment.trim()) {
        setError("退回原因不能为空");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${versionId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "审批失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function newRevision() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${versionId}/revision`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "新建修订版失败");
        return;
      }
      router.push(`/quotes/${body.versionId}`);
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
        <div className="banner ai" role="status">
          {info}
        </div>
      ) : null}

      <Card title="报价行" sub={`${lines.length} 行 · 币种 ${currency}`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>行</th>
                <th>MPN</th>
                <th>成本分类</th>
                <th>物料类别</th>
                <th className="num">数量</th>
                <th className="num">采购成本</th>
                <th className="num">Markup</th>
                <th className="num">最终单价</th>
                <th className="num">小计</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={10} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无报价行
                  </td>
                </tr>
              ) : (
                lines.map((l) => {
                  const calc = byLineNo.get(l.lineNo);
                  return (
                    <tr key={l.id} className={!l.categoryConfirmed ? "row-warn" : undefined}>
                      <td className="num">{l.lineNo}</td>
                      <td className="small">
                        <MpnLink mpn={l.quotedMpn} />
                      </td>
                      <td className="small">{CATEGORY_LABELS[l.category as keyof typeof CATEGORY_LABELS] ?? l.category}</td>
                      <td className="small">
                        {l.materialCategory ?? "-"}{" "}
                        {l.categoryConfirmed ? (
                          <Badge tone="green">已人工确认</Badge>
                        ) : (
                          <Badge tone="amber">待确认</Badge>
                        )}
                      </td>
                      <td className="num small">{l.qty ?? "-"}</td>
                      <td className="num small">{l.purchaseCost ?? "-"}</td>
                      <td className="num small">
                        {l.markupPct ? `${(Number(l.markupPct) * 100).toFixed(1)}%` : "-"}
                      </td>
                      <td className="num small">{calc?.finalUnitPrice ?? "-"}</td>
                      <td className="num small">{calc?.extended ?? "-"}</td>
                      <td>
                        {!frozen ? (
                          <button
                            className="btn xs"
                            disabled={busy}
                            onClick={() => confirmCategory(l.id, l.materialCategory)}
                          >
                            {l.categoryConfirmed ? "重新确认分类" : "确认分类"}
                          </button>
                        ) : (
                          <span className="small muted">已冻结</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="智能体建议" sub="AI 只给建议;写操作必须经确认卡片批准">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn ai" onClick={runAgent} disabled={busy || frozen}>
            运行 QuoteAgent
          </button>
          {agentMode ? (
            <Badge tone={agentMode === "mock" ? "amber" : "purple"}>
              {agentMode === "mock"
                ? "本地规则建议 · 未接入模型"
                : agentMode === "gemini"
                  ? "Gemini"
                  : agentMode === "anthropic"
                    ? "Claude"
                    : agentMode}
            </Badge>
          ) : null}
          {pendingApprovals > 0 ? (
            <Badge tone="gray">{pendingApprovals} 张待确认卡片</Badge>
          ) : null}
          {lastRunId ? <span className="small muted mono">run: {lastRunId.slice(0, 8)}</span> : null}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          智能体输出的是<b>分类与 Markup 建议</b>,金额一律由确定性函数重算;
          确认卡片批准前<b>不会写入任何数据</b>,批准后写入的分类仍需逐行人工确认。
        </p>
      </Card>

      <Card title="流程操作">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!frozen && status === "DRAFT" ? (
            <>
              {bomVersions.length > 0 ? (
                <>
                  <select
                    value={bomVersionId}
                    onChange={(e) => setBomVersionId(e.target.value)}
                    style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid var(--gray-300)" }}
                  >
                    {bomVersions.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                  <button className="btn" onClick={generateFromBom} disabled={busy}>
                    从 BOM 生成报价行
                  </button>
                </>
              ) : null}
              <button className="btn" onClick={addDemoLine} disabled={busy}>
                添加示例行
              </button>
              <button className="btn primary" onClick={submit} disabled={busy}>
                提交审批
              </button>
            </>
          ) : null}
          {transitions.some((t) => t.to === "APPROVED") ? (
            <button className="btn primary" onClick={() => decide("APPROVED")} disabled={busy}>
              批准
            </button>
          ) : null}
          {transitions.some((t) => t.to === "REJECTED") ? (
            <button className="btn" onClick={() => decide("REJECTED")} disabled={busy}>
              退回(需填原因)
            </button>
          ) : null}
          {status === "REJECTED" || status === "APPROVED" ? (
            <button className="btn" onClick={newRevision} disabled={busy}>
              新建 Revision
            </button>
          ) : null}
          {canExport ? (
            <>
              <a className="btn" href={`/api/quotes/${versionId}/export`}>
                导出 XLSX(取快照)
              </a>
              <a className="btn" href={`/quotes/${versionId}/print`} target="_blank" rel="noreferrer">
                打印视图 / 另存为 PDF
              </a>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
