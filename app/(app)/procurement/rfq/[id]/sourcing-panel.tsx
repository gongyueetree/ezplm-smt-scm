"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MpnLink } from "@/components/ui/mpn-link";

interface QuoteLine {
  id: string;
  mpn: string;
  manufacturer: string | null;
  unitPrice: string;
  currency: string;
  leadTimeDays: number | null;
  wasFlagged: boolean;
  flagReasons: { code: string; detail: string }[];
  resolution: string | null;
  resolutionNote: string | null;
  selected: boolean;
  selectionReason: string | null;
  previousLineId: string | null;
  supplierId: string;
}

interface SourcingResult {
  bomLineId: string;
  mpn: string | null;
  manufacturer: string | null;
  demandQty: number;
  totalOffers: number;
  recommended: RankedView | null;
  lowestTotal: RankedView | null;
  eligible: RankedView[];
  excluded: { offer: RankedView; reason: string }[];
}

interface RankedView {
  rank: number;
  purchaseQty: number;
  comparable: boolean;
  stockCovered: boolean;
  leadTimeDays: number | null;
  score: { total: number };
  offer: {
    provider: string;
    providerPartNumber: string | null;
    manufacturer: string | null;
    mpn: string;
    currency: string;
    stock: number | null;
    lifecycle: string;
    sourceUpdatedAt: string | null;
  };
}

interface PolicyView {
  currency: string;
  maxUnitPrice: string | null;
  maxLeadTimeDays: number | null;
  confirmedByBusiness: boolean;
  isFallback: boolean;
}

export function SourcingPanel({
  procurementRfqId,
  lines,
  suppliers,
  policy,
  canSubmit,
  alreadySubmitted,
}: {
  procurementRfqId: string;
  lines: QuoteLine[];
  suppliers: { id: string; code: string; name: string }[];
  policy: PolicyView;
  canSubmit: boolean;
  alreadySubmitted: boolean;
}) {
  const THRESHOLDS = {
    currency: policy.currency,
    maxUnitPrice: policy.maxUnitPrice,
    maxLeadTimeDays: policy.maxLeadTimeDays,
  };
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [results, setResults] = useState<SourcingResult[] | null>(null);
  const [degraded, setDegraded] = useState<{ provider: string; kind: string }[]>([]);
  const [sourcingProgress, setSourcingProgress] = useState<{
    processed: number;
    total: number;
    percent: number;
    done: boolean;
  } | null>(null);

  /** 拉取式分批:逐批询价直到完成(B4:不再静默截断到前 20 个料号) */
  async function runSourcing() {
    setBusy(true);
    setError(null);
    setResults([]);
    setDegraded([]);
    setSourcingProgress(null);
    try {
      const collected: SourcingResult[] = [];
      let offset = 0;
      for (let i = 0; i < 200; i++) {
        const res = await fetch(
          `/api/procurement/rfq/${procurementRfqId}/sourcing?offset=${offset}`,
        );
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(body?.error ?? "询价失败");
          return;
        }
        collected.push(...((body.results ?? []) as SourcingResult[]));
        setResults([...collected]);
        if (body.degraded?.length) {
          setDegraded((prev) => [...prev, ...body.degraded]);
        }
        setSourcingProgress(body.progress);
        if (body.progress?.done) return;
        offset = body.progress?.processed ?? offset + (body.batchSize ?? 20);
      }
    } finally {
      setBusy(false);
    }
  }

  async function importQuote() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("请选择线下供应商报价文件");
      return;
    }
    if (!supplierId) {
      setError("请选择供应商");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("supplierId", supplierId);
      fd.append("currency", THRESHOLDS.currency);
      if (THRESHOLDS.maxUnitPrice) fd.append("maxUnitPrice", THRESHOLDS.maxUnitPrice);
      if (THRESHOLDS.maxLeadTimeDays !== null) fd.append("maxLeadTimeDays", String(THRESHOLDS.maxLeadTimeDays));
      const res = await fetch(`/api/procurement/rfq/${procurementRfqId}/quotes`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "导入失败");
        return;
      }
      if (fileRef.current) fileRef.current.value = "";
      const cols = Object.keys(body.mapping?.fields ?? {}).join("、");
      const skippedNote = body.skipped?.length
        ? `;${body.skipped.length} 行被跳过(${body.skipped[0].reason}…)`
        : "";
      setInfo(
        `已导入 ${body.importedLines} 行报价,异常已在落库时固化。识别到的列:${cols}${skippedNote}`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resolve(lineId: string, resolution: string) {
    setError(null);
    let note: string | null = null;
    let replacement: Record<string, unknown> | null = null;

    if (resolution === "ACCEPT") {
      note = window.prompt("接受异常必须写明理由:");
      if (note === null) return;
    } else {
      const price = window.prompt(
        resolution === "SWITCH_SOURCE" ? "新供应商的单价:" : "新单价:",
      );
      if (price === null) return;
      replacement = {
        supplierId: resolution === "SWITCH_SOURCE" ? (window.prompt("新供应商 ID:") ?? "") : "",
        unitPrice: price,
        currency: THRESHOLDS.currency,
        moq: resolution === "SWITCH_SOURCE" ? Number(window.prompt("MOQ:") ?? "0") : 0,
        spq: resolution === "SWITCH_SOURCE" ? Number(window.prompt("SPQ:") ?? "0") : 0,
        leadTimeDays: Number(window.prompt("Lead Time(天):") ?? "0"),
        quotedAt: new Date().toISOString(),
      };
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/procurement/lines/${lineId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution,
          resolutionNote: note,
          replacement,
          thresholds: THRESHOLDS,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (body?.errors ?? []).map((e: { message: string }) => e.message).join(";");
        setError(detail || body?.error || "处理失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function select(lineId: string, recommendedKey: string | null) {
    setError(null);
    let reason: string | null = null;
    if (recommendedKey && recommendedKey !== lineId) {
      reason = window.prompt("选择与系统推荐不一致,必须填写理由:");
      if (reason === null) return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/procurement/lines/${lineId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendedKey, reason }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "选定失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function feedback() {
    setError(null);
    const note = window.prompt("反馈 PM 的说明(可选):") ?? "";
    setBusy(true);
    try {
      const res = await fetch(`/api/procurement/rfq/${procurementRfqId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "反馈失败");
        return;
      }
      setInfo("已反馈 PM");
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
        <div className="banner info" role="status">
          {info}
        </div>
      ) : null}

      {/*
        S-4(客户 PR2 反馈 采购-4B:「DigiKey、Mouser 线下报价文件和线下供应商报价的
        文件窗口要分开显示 —— digikey mouser 的需要报价,而线下供应商的目的是比较价格」)。

        原来两件事挤在同一张卡片的同一行:左边按官方 API 去「要」报价,
        右边上传对方发来的报价文件回来「比」价。来源、动作、用途都不同,
        并排放既难认也容易点错(还共用同一个 busy 状态)。
      */}
      <Card title="①A 三方实时询价" sub="DigiKey / Mouser 官方 API · 主动去「要」报价">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn ai" onClick={runSourcing} disabled={busy}>
            {busy ? "查询中…" : "查询 DigiKey / Mouser"}
          </button>
          <span className="small muted">
            按本 RFQ 的料清单批量查询,结果进下方比价集合。显示的是数据更新时间,不代表实时价。
          </span>
        </div>
        {sourcingProgress ? (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                height: 8,
                background: "var(--gray-150)",
                borderRadius: 999,
                overflow: "hidden",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  width: `${sourcingProgress.percent}%`,
                  height: "100%",
                  background: sourcingProgress.done ? "var(--brand)" : "var(--ai)",
                  transition: "width 200ms",
                }}
              />
            </div>
            <p className="small muted">
              询价进度 {sourcingProgress.processed} / {sourcingProgress.total} 个料号 ·{" "}
              {sourcingProgress.percent}%
              {sourcingProgress.done ? " · 已完成" : " · 分批进行中"}
            </p>
          </div>
        ) : null}

        {degraded.length > 0 ? (
          <div className="banner warn" style={{ marginTop: 10 }}>
            外部数据源降级(不影响其余报价):
            {degraded.map((d, i) => (
              <span key={i}>
                {" "}
                {d.provider}/{d.kind}
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      <Card title="①B 线下供应商报价导入" sub="上传对方发来的报价文件 · 拿回来「比」价">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="fld" style={{ marginBottom: 0, minWidth: 180 }}>
            <span>线下供应商</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
            {/* label 保持原文 —— 卡片标题已给上下文,但改短它只会打断既有用例、不带来价值 */}
            <span>线下报价文件(CSV/XLSX)</span>
            <input ref={fileRef} type="file" />
          </label>
          <button className="btn" onClick={importQuote} disabled={busy}>
            导入线下报价
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          价格线 {THRESHOLDS.currency} {THRESHOLDS.maxUnitPrice ?? "未设"} · 交期线{" "}
          {THRESHOLDS.maxLeadTimeDays ?? "未设"} 天
          {policy.confirmedByBusiness ? (
            <Badge tone="green">口径已业务确认</Badge>
          ) : (
            <Badge tone="amber">
              {policy.isFallback ? "未配置,使用兜底值" : "口径待业务确认"} · 非正式风控
            </Badge>
          )}
          。导入时按此阈值<b>固化原始异常集合</b>,此后阈值调整不改写既有标记。
          阈值在<a href="/procurement/suppliers">「供应商与采购策略」</a>维护。
        </p>
      </Card>

      {results ? (
        <Card
          title="② 多源比价"
          sub={`${results.length} 个料号`}
          flush
          actions={
            /*
              N-5.E:导出总表。链接直下,不经前端状态 ——
              接口从 SupplierQuoteLine 取全部报价(线下 + 三方),
              导出的是库里的事实,而不是页面上当前恰好显示了什么。
            */
            <a
              className="btn"
              href={`/api/procurement/rfq/${procurementRfqId}/compare-export`}
              data-testid="compare-export"
            >
              导出比价总表(xlsx)
            </a>
          }
        >
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>料号</th>
                  <th className="num">需求</th>
                  <th>合格报价(排名 · 来源 · 制造商 · 采购量 · 币种 · 库存 · 生命周期 · 数据更新)</th>
                  <th>被排除</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.bomLineId}>
                    <td className="small">
                      <div>
                        <MpnLink mpn={r.mpn} />
                      </div>
                      <div className="muted">{r.manufacturer ?? "-"}</div>
                    </td>
                    <td className="num">{r.demandQty}</td>
                    <td className="small">
                      {r.eligible.length === 0 ? (
                        <span className="muted">无合格报价</span>
                      ) : (
                        r.eligible.slice(0, 4).map((e, i) => {
                          const isRec = r.recommended?.offer.providerPartNumber === e.offer.providerPartNumber;
                          const isLow = r.lowestTotal?.offer.providerPartNumber === e.offer.providerPartNumber;
                          return (
                            <div key={i} style={{ marginBottom: 4 }}>
                              <Badge tone="blue">#{e.rank}</Badge> {e.offer.provider} ·{" "}
                              {e.offer.manufacturer ?? "-"} · {e.purchaseQty} 件 · {e.offer.currency} ·
                              库存 {e.offer.stock ?? "未知"} · {e.offer.lifecycle} · 数据更新{" "}
                              {e.offer.sourceUpdatedAt?.slice(0, 10) ?? "未知"}{" "}
                              {isRec ? <Badge tone="green">推荐</Badge> : null}
                              {isLow ? <Badge tone="amber">最低总价</Badge> : null}
                            </div>
                          );
                        })
                      )}
                    </td>
                    <td className="small muted">
                      {r.excluded.length === 0
                        ? "-"
                        : r.excluded.slice(0, 3).map((x, i) => (
                            <div key={i}>
                              {x.offer.offer.provider}:{x.reason}
                            </div>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card
        title="③ 线下报价行与异常处理"
        sub="原始异常集合固化;结论默认空,逐项人工选"
        flush
      >
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>料号</th>
                <th className="num">单价</th>
                <th className="num">交期</th>
                <th>异常</th>
                <th>处理结论</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无线下报价,使用上方导入
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.id} className={l.wasFlagged && !l.resolution ? "row-danger" : undefined}>
                    <td className="small">
                      <div>
                        <MpnLink mpn={l.mpn} />
                      </div>
                      <div className="muted">{l.manufacturer ?? "-"}</div>
                      {l.previousLineId ? <Badge tone="purple">换货源新行</Badge> : null}
                    </td>
                    <td className="num small">
                      {l.currency} {l.unitPrice}
                    </td>
                    <td className="num small">{l.leadTimeDays ?? "-"}</td>
                    <td className="small">
                      {l.wasFlagged ? (
                        <>
                          <Badge tone="red">原始异常</Badge>
                          <div className="muted" style={{ marginTop: 2 }}>
                            {l.flagReasons.map((r) => r.detail).join(";")}
                          </div>
                        </>
                      ) : (
                        <Badge tone="green">正常</Badge>
                      )}
                    </td>
                    <td className="small">
                      {l.resolution ? (
                        <>
                          <Badge tone="green">{l.resolution}</Badge>
                          {l.resolutionNote ? (
                            <div className="muted">{l.resolutionNote}</div>
                          ) : null}
                        </>
                      ) : l.wasFlagged ? (
                        <Badge tone="gray">待处理</Badge>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {l.wasFlagged && !l.resolution ? (
                          <>
                            <button className="btn xs" disabled={busy} onClick={() => resolve(l.id, "ACCEPT")}>
                              接受
                            </button>
                            <button className="btn xs" disabled={busy} onClick={() => resolve(l.id, "ADJUST_PRICE")}>
                              调价
                            </button>
                            <button
                              className="btn xs"
                              disabled={busy}
                              onClick={() => resolve(l.id, "SWITCH_SOURCE")}
                            >
                              换货源
                            </button>
                          </>
                        ) : null}
                        <button
                          className={`btn xs ${l.selected ? "primary" : ""}`}
                          disabled={busy}
                          onClick={() => select(l.id, null)}
                        >
                          {l.selected ? "✓ 已选定" : "选定"}
                        </button>
                      </div>
                      {l.selectionReason ? (
                        <div className="small muted" style={{ marginTop: 2 }}>
                          理由:{l.selectionReason}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="④ 反馈 PM">
        <p className="small muted" style={{ marginBottom: 10 }}>
          必须<b>全部原始异常行</b>都已给出处理结论后方可反馈(不按当前是否仍超线判断)。
        </p>
        <button className="btn primary" onClick={feedback} disabled={busy || !canSubmit || alreadySubmitted}>
          {alreadySubmitted ? "已反馈 PM" : canSubmit ? "反馈给 PM" : "尚有未处理异常,不可反馈"}
        </button>
      </Card>
    </div>
  );
}
