"use client";

/**
 * 替代候选结果卡片(替代料查询工具与物料详情页共用)。
 *
 * 抽出来是为了两处**长得一样**:详情页里勾选的那条,和工具页里看到的那条,
 * 必须是同一个评分口径与同一套措辞,否则人会以为是两套结论。
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { MpnLink } from "@/components/ui/mpn-link";
import { SOURCE_LABELS } from "@/lib/domain/alternate-score";
import type { MarketSummary } from "@/lib/domain/market-summary";

export interface ParamRow {
  key: string;
  label: string;
  actual: string | null;
  source: keyof typeof SOURCE_LABELS;
  score: number | null;
  verdict: string;
  detail: string;
}

/** 与领域层同一个类型 —— 展示口径必须跟计算口径一致 */
export type MarketSummaryView = MarketSummary;

export interface ScoredResult {
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
  market: MarketSummaryView | null;
}

const VERDICT_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  一致: "green",
  更优: "green",
  部分覆盖: "amber",
  有差异: "red",
  缺失: "gray",
  未知: "gray",
};

/** 评分环:纯 SVG,不引图表库(离线部署禁 CDN) */
export function ScoreRing({ value, size = 46 }: { value: number; size?: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const tone = value >= 80 ? "var(--brand)" : value >= 60 ? "#b58105" : "var(--danger)";
  return (
    <svg width={size} height={size} viewBox="0 0 46 46" role="img" aria-label={`结论可信 ${value}`}>
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

export function Metric({ value, label }: { value: number; label: string }) {
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

export function MarketBlock({ market }: { market: MarketSummaryView }) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: "8px 10px",
        border: "1px solid var(--gray-200)",
        borderRadius: 8,
        background: "var(--gray-50)",
      }}
    >
      <div className="small" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <b>市场行情</b>
        {market.tiers.map((t) => (
          <span key={t.qty}>
            {t.qty}片 = {t.currency} {t.unitPrice}
            <span className="muted"> ({t.provider})</span>
          </span>
        ))}
        <span>
          供货:
          <Badge
            tone={
              market.availability === "充足"
                ? "green"
                : market.availability === "一般"
                  ? "blue"
                  : market.availability === "未知"
                    ? "gray"
                    : "amber"
            }
          >
            {market.availability}
          </Badge>
        </span>
        {market.totalStock !== null ? (
          <span className="muted">合计库存 {market.totalStock}</span>
        ) : (
          <span className="muted">库存未知</span>
        )}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        {market.channels.length > 0 ? `渠道:${market.channels.join("、")}` : "暂无有货渠道"}
        {market.dataUpdatedAt
          ? ` · 数据更新 ${market.dataUpdatedAt.slice(0, 10)}`
          : " · 数据时间未知"}
        {" · "}
        <b>非实时行情</b>,分销商目录价,通常不含关税/运费/税费
        {market.mixedCurrency ? " · ⚠ 含多种币种,系统不做汇率换算,不可直接比较" : ""}
      </div>
    </div>
  );
}

export interface AlternateResultCardProps {
  result: ScoredResult;
  rank: number;
  /** 传入即显示勾选框;勾选是**人工动作**,系统不会自动替换任何料 */
  selected?: boolean;
  onToggleSelect?: (next: boolean) => void;
  selectBusy?: boolean;
  /** 本次查询是否勾了「查询市场行情」;勾了却没取到要如实说明,不能静默留白 */
  marketRequested?: boolean;
}

export function AlternateResultCard({
  result: r,
  rank,
  selected,
  onToggleSelect,
  selectBusy,
  marketRequested,
}: AlternateResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }} data-alt-mpn={r.mpn}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {onToggleSelect ? (
          <label
            style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}
            title="加入候选清单(待工程确认,不代表已成立替代关系)"
          >
            <input
              type="checkbox"
              checked={Boolean(selected)}
              disabled={selectBusy}
              onChange={(e) => onToggleSelect(e.target.checked)}
              aria-label={`勾选 ${r.mpn} 为候选替代料`}
            />
            <span className="small">选用</span>
          </label>
        ) : null}
        <Badge tone="gray">#{rank}</Badge>
        <ScoreRing value={r.confidence} />
        <Badge tone={r.modeTag.startsWith("[P2]") ? "green" : "amber"}>{r.modeTag}</Badge>
        <MpnLink mpn={r.mpn} />
        {r.preferredVendor ? <Badge tone="purple">优选厂商</Badge> : null}
        <button
          className="btn xs"
          style={{ marginLeft: "auto" }}
          onClick={() => setExpanded((p) => !p)}
        >
          {expanded ? "收起参数对比" : "参数对比详情"}
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

      {r.market ? (
        <MarketBlock market={r.market} />
      ) : marketRequested ? (
        // 勾了行情却没拿到:数据源未配置或未返回。**说清楚**,
        // 留白会让人以为系统压根没查
        <div className="banner soft" style={{ marginTop: 8 }}>
          <span className="small">
            未取到行情 —— 分销商数据源未配置或本次未返回该型号报价。
            这不代表无货或无价,只代表<b>此处查不到</b>。
          </span>
        </div>
      ) : null}

      {r.warnings.map((w, k) => (
        <div className="banner warn" key={k} style={{ marginTop: 8 }}>
          ⚠ {w}
        </div>
      ))}

      {expanded ? (
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
  );
}
