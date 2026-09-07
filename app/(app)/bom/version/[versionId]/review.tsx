"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { MpnLink } from "@/components/ui/mpn-link";

/** 来源标签:相似度类候选要一眼看出"只是像",不能与精确命中混淆 */
const SOURCE_LABEL: Record<string, string> = {
  CUSTOMER_MAPPING: "客户料号映射",
  INTERNAL_PN: "内部料号",
  EXACT_MPN: "精确 MPN",
  MFR_MPN: "制造商+MPN",
  DESCRIPTION: "描述相似",
  LOCAL_SIMILAR: "本地库·型号相似",
  EZPLM_SIMILAR: "ezPLM·型号相似",
  EZPLM: "ezPLM",
  DIGIKEY: "DigiKey",
  MOUSER: "Mouser",
  MANUAL: "人工指定",
};

const SIMILAR_SOURCES = new Set(["LOCAL_SIMILAR", "EZPLM_SIMILAR", "DESCRIPTION"]);

export interface ReviewCandidate {
  id: string;
  source: string;
  confidence: number;
  /** 相似度候选的判断依据(为什么它排在这里) */
  matchReason?: string | null;
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
  /** 需要找替代料时的原因;不需要为 null */
  alternateHint?: string | null;
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
  /** F7:已匹配内部料的本地库存快照(经 MasterDataProvider 缓存);null=无快照(待接入) */
  inventory?: { qty: number; fetchedAt: string } | null;
  /** F7:既有 PartAlternate 替代关系数(只读) */
  alternateCount?: number;
}

/** F7:相似度类来源 —— 永不进批量确认(与 lib/domain/bom-detail.ts 同一口径) */
const BULK_SIMILARITY_SOURCES = SIMILAR_SOURCES;

type ReviewFilter = "all" | "needs-review" | "unrecognized" | "has-alternate";

/** 行分类(与服务端 deriveBomKpis 同口径;显示用,资格最终由服务端复核) */
function classifyLine(l: ReviewLine, threshold: number) {
  if (l.decision) return "decided" as const;
  if (l.candidates.length === 0) return "unrecognized" as const;
  const top = l.candidates[0];
  if (top.confidence >= threshold && !BULK_SIMILARITY_SOURCES.has(top.source)) {
    return "batch-eligible" as const;
  }
  return "needs-review" as const;
}

const LIFECYCLE_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  ACTIVE: "green",
  NRND: "amber",
  EOL: "red",
  OBSOLETE: "red",
  UNKNOWN: "gray",
};

export function MatchReview({
  lines,
  versionId,
  threshold,
}: {
  lines: ReviewLine[];
  /** F7:提供 versionId + threshold 时启用筛选与批量确认(阈值为租户配置,不硬编码) */
  versionId?: string;
  threshold?: number;
}) {
  const router = useRouter();
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkChecked, setBulkChecked] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    confirmed: number;
    skipped: { lineId: string; lineNo: number | null; reason: string }[];
  } | null>(null);

  const [manualMpn, setManualMpn] = useState<Record<string, string>>({});

  const bulkEnabled = versionId !== undefined && threshold !== undefined;
  const eligible = bulkEnabled
    ? lines.filter((l) => classifyLine(l, threshold!) === "batch-eligible")
    : [];

  const visible =
    !bulkEnabled || filter === "all"
      ? lines
      : lines.filter((l) => {
          const cls = classifyLine(l, threshold!);
          if (filter === "needs-review") return cls === "needs-review";
          if (filter === "unrecognized") return cls === "unrecognized";
          return (l.alternateCount ?? 0) > 0 || Boolean(l.alternateHint);
        });

  function openBulk() {
    // 默认全勾;弹卡里可逐条取消
    setBulkChecked(Object.fromEntries(eligible.map((l) => [l.id, true])));
    setBulkResult(null);
    setBulkOpen(true);
  }

  async function submitBulk() {
    const lineIds = eligible.filter((l) => bulkChecked[l.id]).map((l) => l.id);
    if (lineIds.length === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bom/version/${versionId}/bulk-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineIds }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "批量确认失败");
        return;
      }
      setBulkResult(body);
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function decide(
    lineId: string,
    decision: string,
    candidateId?: string,
    extra?: Record<string, unknown>,
  ) {
    setBusyLine(lineId);
    setError(null);
    try {
      const res = await fetch(`/api/bom/lines/${lineId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, candidateId: candidateId ?? null, ...extra }),
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

      {bulkEnabled ? (
        <div
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "10px 16px" }}
          data-testid="review-toolbar"
        >
          {(
            [
              ["all", `全部(${lines.length})`],
              ["needs-review", `需人工确认(${lines.filter((l) => classifyLine(l, threshold!) === "needs-review").length})`],
              ["unrecognized", `未识别(${lines.filter((l) => classifyLine(l, threshold!) === "unrecognized").length})`],
              ["has-alternate", `有替代(${lines.filter((l) => (l.alternateCount ?? 0) > 0 || l.alternateHint).length})`],
            ] as [ReviewFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={`btn xs${filter === key ? " primary" : ""}`}
              onClick={() => setFilter(key)}
              data-testid={`review-filter-${key}`}
            >
              {label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button
            className="btn"
            disabled={eligible.length === 0}
            onClick={openBulk}
            data-testid="bulk-confirm-open"
            title={eligible.length === 0 ? "没有达到阈值的未决行" : undefined}
          >
            一键确认高置信匹配({eligible.length} 行 ≥ {(threshold! * 100).toFixed(0)}%)
          </button>
        </div>
      ) : null}

      {bulkOpen ? (
        <div className="banner soft" style={{ margin: "0 16px 10px" }} data-testid="bulk-confirm-card">
          {bulkResult ? (
            <div>
              <b>批量确认完成</b>:已确认 {bulkResult.confirmed} 行
              {bulkResult.skipped.length > 0 ? (
                <>
                  ,跳过 {bulkResult.skipped.length} 行:
                  <ul className="small" style={{ margin: "4px 0 0 18px" }}>
                    {bulkResult.skipped.slice(0, 10).map((s) => (
                      <li key={s.lineId}>
                        {s.lineNo !== null ? `第 ${s.lineNo} 行` : s.lineId}:{s.reason}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <div style={{ marginTop: 6 }}>
                <button className="btn xs" onClick={() => setBulkOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
          ) : (
            <div>
              <b>确认卡片</b>:即将批量确认以下 <b>{eligible.filter((l) => bulkChecked[l.id]).length}</b> 行
              (首选候选置信度 ≥ 阈值 <b>{(threshold! * 100).toFixed(0)}%</b>,相似度来源已排除)。
              可逐条取消勾选;每行写入独立人工决定 + 一条批量审计。
              <div style={{ maxHeight: 220, overflow: "auto", margin: "6px 0" }}>
                {eligible.map((l) => (
                  <label key={l.id} className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={bulkChecked[l.id] ?? false}
                      onChange={(e) => setBulkChecked((prev) => ({ ...prev, [l.id]: e.target.checked }))}
                      data-testid={`bulk-line-${l.lineNo}`}
                    />
                    第 {l.lineNo} 行 · {l.refDes ?? "-"} · {l.candidates[0]?.mpn}(
                    {(l.candidates[0]?.confidence * 100).toFixed(0)}% · {SOURCE_LABEL[l.candidates[0]?.source] ?? l.candidates[0]?.source})
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn primary"
                  disabled={bulkBusy || eligible.filter((l) => bulkChecked[l.id]).length === 0}
                  onClick={() => void submitBulk()}
                  data-testid="bulk-confirm-submit"
                >
                  {bulkBusy ? "确认中…" : `确认 ${eligible.filter((l) => bulkChecked[l.id]).length} 行`}
                </button>
                <button className="btn" onClick={() => setBulkOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          )}
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
            {visible.map((l) => (
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
                  {l.alternateHint && l.mpn ? (
                    <div style={{ marginTop: 4 }}>
                      <a
                        className="btn xs"
                        href={`/materials/alternates?mpn=${encodeURIComponent(l.mpn)}`}
                      >
                        查替代料
                      </a>
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                    {l.mpnSource === "inferred-from-value" ? (
                      <Badge tone="amber">MPN 由 Value 推断 · 待人工确认</Badge>
                    ) : null}
                    {l.alternateHint ? (
                      <Badge tone="amber">{l.alternateHint}</Badge>
                    ) : null}
                    {l.flags.dupRefDes ? <Badge tone="red">位号重复</Badge> : null}
                    {l.flags.eol ? <Badge tone="red">EOL</Badge> : null}
                    {l.flags.footprintMismatch ? <Badge tone="amber">封装不一致</Badge> : null}
                    {l.candidates.length >= 2 ? (
                      <Badge tone="blue">{l.candidates.length} 候选</Badge>
                    ) : null}
                    {(l.alternateCount ?? 0) > 0 ? (
                      <Badge tone="gray">有 {l.alternateCount} 个替代</Badge>
                    ) : null}
                  </div>
                  {l.inventory !== undefined ? (
                    <div className="muted" style={{ marginTop: 4 }}>
                      库存{" "}
                      {l.inventory ? (
                        <>
                          {l.inventory.qty}(快照 {l.inventory.fetchedAt})
                        </>
                      ) : (
                        "待接入(无 ERP 快照,不按 0 计)"
                      )}
                    </div>
                  ) : null}
                </td>
                <td>
                  {l.candidates.length === 0 ? (
                    <span className="small muted">
                      无候选 —— 可在右侧<b>直接填写型号</b>人工指定,或标记无匹配
                    </span>
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
                              <Badge tone={SIMILAR_SOURCES.has(c.source) ? "amber" : "blue"}>
                                {SOURCE_LABEL[c.source] ?? c.source}
                              </Badge>
                              <MpnLink mpn={c.mpn} />
                              <span className="muted">{c.manufacturer ?? "-"}</span>
                              <Badge tone={LIFECYCLE_TONE[c.lifecycle ?? "UNKNOWN"] ?? "gray"}>
                                {c.lifecycle ?? "生命周期未知"}
                              </Badge>
                              <span className="muted">置信度 {(c.confidence * 100).toFixed(0)}%</span>
                            </div>
                            {c.matchReason ? (
                              <div className="small muted" style={{ marginTop: 2 }}>
                                依据:{c.matchReason}
                              </div>
                            ) : null}
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
                      {l.decision.decision === "NO_MATCH"
                        ? "已标记无匹配"
                        : l.decision.decision === "MANUAL_ASSIGN"
                          ? "已人工指定"
                          : "已确认"}
                    </Badge>
                  ) : (
                    <Badge tone="gray">待确认</Badge>
                  )}
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                    {/* 人工指定:候选里没有想要的那颗时,直接填型号 */}
                    <input
                      className="input-xs"
                      style={{ width: 168 }}
                      placeholder="人工指定型号"
                      aria-label={`第 ${l.lineNo} 行人工指定型号`}
                      value={manualMpn[l.id] ?? ""}
                      onChange={(e) =>
                        setManualMpn((prev) => ({ ...prev, [l.id]: e.target.value }))
                      }
                    />
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        className="btn xs"
                        disabled={busyLine === l.id || !(manualMpn[l.id] ?? "").trim()}
                        onClick={() =>
                          decide(l.id, "MANUAL_ASSIGN", undefined, {
                            manualMpn: (manualMpn[l.id] ?? "").trim(),
                          })
                        }
                      >
                        确认指定
                      </button>
                      <button
                        className="btn xs"
                        disabled={busyLine === l.id}
                        onClick={() => decide(l.id, "NO_MATCH")}
                      >
                        标记无匹配
                      </button>
                    </div>
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
