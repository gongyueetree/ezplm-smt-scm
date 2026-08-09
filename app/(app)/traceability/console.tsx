"use client";

/**
 * 追溯控制台:导入 → 查询 → 影响范围 → 处置提议。
 *
 * 与截图的差别是**有意的**:截图里「Trace Agent 自动处置动作(已执行 6/6 项)」
 * 违反纪律 —— Agent 不得自动冻结/通知/召回。这里所有动作都是**建议**,
 * 需人工提议 + 他人批准,且批准后只到「本系统已登记」。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { NODE_KIND_LABEL, parseRef, type BlastRadius } from "@/lib/domain/trace-graph";
import { TEMPLATE_HEADERS, TEMPLATE_LABEL, type TraceTemplate } from "@/lib/domain/trace-import";

interface TraceCoverage {
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
}

interface TraceResult {
  sourceRef: string;
  forward: { layers: string[][] };
  backward: { layers: string[][] };
  blastRadius: BlastRadius;
  /*
   * ⚠️ A-3:下面四项以前**接口返回了但页面没渲染**。
   * 影响面 KPI 照常显示、截断与低置信度却看不见 ——
   * 使用者看到的是一份"看起来很确定"的结论。
   */
  scopeNote?: string;
  truncatedNotice?: string | null;
  edgeCapHit?: boolean;
  coverage?: TraceCoverage;
  conclusionCaveat?: string;
}

const CONFIDENCE_LABEL: Record<TraceCoverage["confidence"], string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

const ACTION_KINDS = [
  { id: "FREEZE_LOT", label: "冻结库存批次" },
  { id: "PAUSE_WORK_ORDER", label: "暂停相关工单" },
  { id: "MARK_RECHECK", label: "标记待复检" },
  { id: "DRAFT_RMA", label: "创建客诉/RMA 草稿" },
  { id: "NOTIFY_SUPPLIER", label: "生成供应商通知草稿" },
  { id: "NOTIFY_CUSTOMER", label: "生成客户通知草稿" },
  { id: "CREATE_CAPA", label: "创建 CAPA/整改任务" },
  { id: "RECALL_ASSESSMENT", label: "创建召回评估" },
  { id: "EXPORT_QUARANTINE_LIST", label: "导出隔离清单" },
] as const;

export function TraceConsole({
  canImport,
  canAnalyze,
  canPropose,
}: {
  canImport: boolean;
  canAnalyze: boolean;
  canPropose: boolean;
  canApprove?: boolean;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState<TraceTemplate>("RECEIPT");
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TraceResult | null>(null);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [incidentCode, setIncidentCode] = useState("");

  async function runImport() {
    setBusy("import");
    setError(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/trace/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, text: importText }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          `${body?.error ?? "导入失败"}${
            body?.errors?.length
              ? `:${body.errors.slice(0, 5).map((e: { row: number; message: string }) => `第 ${e.row} 行 ${e.message}`).join(";")}`
              : ""
          }`,
        );
        return;
      }
      setImportResult(body);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function runQuery(ref?: string) {
    setBusy("query");
    setError(null);
    setCandidates(null);
    try {
      const url = ref
        ? `/api/trace/query?ref=${encodeURIComponent(ref)}`
        : `/api/trace/query?q=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "查询失败");
        setResult(null);
        return;
      }
      if (body.candidates) {
        setCandidates(body.candidates);
        setResult(null);
        return;
      }
      setResult(body);
    } finally {
      setBusy(null);
    }
  }

  async function proposeActions() {
    if (!result || selectedActions.length === 0) return;
    setBusy("propose");
    setError(null);
    try {
      const code = incidentCode.trim() || `QI-${Date.now()}`;
      const inc = await fetch("/api/trace/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          title: `${result.sourceRef} 异常影响面处置`,
          sourceRef: result.sourceRef,
        }),
      });
      const incBody = await inc.json().catch(() => null);
      if (!inc.ok) {
        setError(incBody?.error ?? "创建质量事件失败");
        return;
      }
      const res = await fetch(`/api/trace/incidents/${incBody.id}/containment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actions: selectedActions.map((kind) => ({ kind, targetRef: result.sourceRef })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "提议失败");
        return;
      }
      setSelectedActions([]);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const br = result?.blastRadius;

  return (
    <>
      {canImport ? (
        <Card title="数据导入" sub="三张标准模板 · 行级校验 · 重复导入幂等">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {(["RECEIPT", "WO_ISSUE", "SHIPMENT"] as const).map((t) => (
              <button
                key={t}
                className={`btn sm${template === t ? " primary" : ""}`}
                onClick={() => setTemplate(t)}
              >
                {TEMPLATE_LABEL[t]}
              </button>
            ))}
            <button
              className="btn xs"
              onClick={() => setImportText(TEMPLATE_HEADERS[template].join(","))}
            >
              填入表头模板
            </button>
          </div>
          <label className="fld">
            <span>粘贴表格(必需列见下方提示)</span>
            <textarea
              rows={6}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={TEMPLATE_HEADERS[template].join(",")}
              style={{ fontFamily: "var(--mono, monospace)", fontSize: 12 }}
            />
          </label>
          <p className="small muted">
            表头示例:{TEMPLATE_HEADERS[template].join(" / ")}
          </p>
          <button className="btn primary" disabled={busy !== null || !importText.trim()} onClick={() => void runImport()}>
            {busy === "import" ? "导入中…" : "导入"}
          </button>

          {importResult ? (
            <div className="banner soft" style={{ marginTop: 10 }} data-testid="trace-import-result">
              成功 {String(importResult.okRows)} 行 · 失败 {String(importResult.errorRows)} 行
              {importResult.duplicated ? " · ⚠ 幂等命中,已复用既有导入批次" : ""}
              {Array.isArray(importResult.notices) && importResult.notices.length > 0 ? (
                <div className="small">{(importResult.notices as string[]).join(";")}</div>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card title="批次级全链路追溯" sub="支持 批次 / 工单 / 成品批次 / 出货单 / PO">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
            <span>查询条件</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="如 SR2026-USB-189 / WO-26-0412 / PO-2026-0410"
              onKeyDown={(e) => {
                if (e.key === "Enter") void runQuery();
              }}
            />
          </label>
          <button className="btn primary" disabled={busy !== null || !query.trim()} onClick={() => void runQuery()}>
            {busy === "query" ? "追溯中…" : "开始追溯"}
          </button>
        </div>

        {candidates ? (
          <div className="banner soft" style={{ marginTop: 10 }}>
            命中多个对象,请选择:
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {candidates.map((c) => (
                <button key={c} className="btn xs" onClick={() => void runQuery(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="banner warn" style={{ marginTop: 10 }} data-testid="trace-error">
            {error}
          </div>
        ) : null}

        {br ? (
          <div style={{ marginTop: 12 }} data-testid="trace-result">
            <div className="banner soft">
              <b>{br.granularityNote}</b>
              {result?.scopeNote ? <div className="small">{result.scopeNote}</div> : null}
            </div>

            {/*
              截断提示优先于一切结论显示 ——
              图不完整时,下面的 KPI 全是**下限**,不是真实影响面。
            */}
            {result?.truncatedNotice ? (
              <div className="banner danger" data-testid="trace-truncated">
                <b>{result.truncatedNotice}</b>
              </div>
            ) : null}

            {result?.coverage ? (
              <div
                className={result.coverage.confidence === "HIGH" ? "banner soft" : "banner warn"}
                data-testid="trace-confidence"
              >
                <b>
                  结论置信度:{CONFIDENCE_LABEL[result.coverage.confidence]}(覆盖分{" "}
                  {result.coverage.score})
                </b>
                {result.conclusionCaveat ? (
                  <div className="small">{result.conclusionCaveat}</div>
                ) : null}
                {result.coverage.reasons.length > 0 ? (
                  <ul style={{ margin: "4px 0 0 18px" }}>
                    {result.coverage.reasons.map((r, i) => (
                      <li key={i} className="small muted">
                        {r}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="kpi-grid">
              <div className="kpi">
                <div className="kpi-label">受影响物料批次</div>
                <div className="kpi-value">{br.affectedLots}</div>
                <div className="kpi-foot">仍在库 {br.onHandQty}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">受影响工单</div>
                <div className="kpi-value">{br.affectedWorkOrders}</div>
                <div className="kpi-foot">在制 {br.wipWorkOrders}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">受影响成品批次</div>
                <div className="kpi-value">{br.affectedFgLots}</div>
                <div className="kpi-foot">已出货 {br.shippedQty}</div>
              </div>
              <div className={br.affectedCustomers > 0 ? "kpi danger" : "kpi"}>
                <div className="kpi-label">受影响客户</div>
                <div className="kpi-value">{br.affectedCustomers}</div>
                <div className="kpi-foot">出货单 {br.affectedShipments}</div>
              </div>
            </div>

            {br.qtyUnknownEdges > 0 ? (
              <div className="banner warn">
                有 <b>{br.qtyUnknownEdges}</b> 条流转关系缺少数量 —— 上面的数量合计
                <b>不包含这部分</b>,不是「这部分为 0」。
              </div>
            ) : null}

            {/* 数据缺口:这是"数据缺失 ≠ 无影响"的呈现处 */}
            {br.gaps.length > 0 ? (
              <div className="banner warn" data-testid="trace-gaps">
                <b>发现 {br.gaps.length} 处数据缺口</b>
                {br.gaps.map((g, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div className="small">
                      {g.message}(涉及 {g.danglingRefs.length} 个{NODE_KIND_LABEL[g.afterKind]})
                    </div>
                    <ul style={{ margin: "2px 0 0 18px" }}>
                      {g.possibleCauses.map((c, k) => (
                        <li key={k} className="small muted">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}

            <Card title="影响层级" sub="第 1 层为异常源,依供应链正向顺序展开" flush>
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>层</th>
                      <th>类型</th>
                      <th>对象</th>
                    </tr>
                  </thead>
                  <tbody>
                    {br.layers.map((l) => (
                      <tr key={l.level}>
                        <td>{l.level}</td>
                        <td className="small">
                          {l.kind === "MIXED" ? "混合" : NODE_KIND_LABEL[l.kind]}
                        </td>
                        <td className="small mono">
                          {l.refs
                            .map((r) => {
                              const p = parseRef(r);
                              return p ? p.key : r;
                            })
                            .join("、")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="反向追溯" sub="这批货是用什么料做的" flush>
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>层</th>
                      <th>对象</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result!.backward.layers.map((refs, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td className="small mono">{refs.join("、")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {canPropose && canAnalyze ? (
              <Card
                title="建议处置动作"
                sub="全部为**建议** —— 需人工提议并由他人批准;批准后也只到「本系统已登记」"
              >
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {ACTION_KINDS.map((a) => (
                    <label key={a.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedActions.includes(a.id)}
                        onChange={(e) =>
                          setSelectedActions((p) =>
                            e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id),
                          )
                        }
                      />
                      <span className="small">{a.label}</span>
                    </label>
                  ))}
                </div>
                <label className="fld">
                  <span>质量事件编号(留空自动生成)</span>
                  <input value={incidentCode} onChange={(e) => setIncidentCode(e.target.value)} />
                </label>
                <button
                  className="btn primary"
                  disabled={busy !== null || selectedActions.length === 0}
                  onClick={() => void proposeActions()}
                >
                  {busy === "propose" ? "提交中…" : `提议 ${selectedActions.length} 项处置(待审批)`}
                </button>
                <p className="small muted" style={{ marginTop: 6 }}>
                  提议不会执行任何操作。批准后:本系统登记冻结/暂停标记;
                  <b>ERP 回写待执行、MES 联动未接入</b> —— 不代表产线或 ERP 已实际冻结。
                </p>
              </Card>
            ) : null}
          </div>
        ) : null}
      </Card>
    </>
  );
}
