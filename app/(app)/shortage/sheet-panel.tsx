"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SHORTAGE_STATUS_LABEL, type ShortageStatus } from "@/lib/domain/shortage-sheet";

/**
 * PR2-PROC-10:缺料单驱动的处理台。
 *
 * 客户原话:「缺料分析是根据**缺料分析单**来的,而非 BOM」。
 * 所以这块放在页面最前 —— 它是业务单据;下方按 BOM 推算的那块是核算工具,
 * 两者不能混为一谈,页面上分别标注。
 */
export interface SheetLineView {
  id: string;
  customerName: string | null;
  internalPn: string | null;
  manufacturer: string | null;
  mpn: string | null;
  requiredQty: string;
  availableInventory: string | null;
  openPoQty: string | null;
  supplierName: string | null;
  eta: string | null;
  shortageQty: string;
  callQty: string | null;
  requiredDate: string | null;
  status: ShortageStatus;
  /** 已生成的邮件草稿数;>0 且未发送时界面必须说「待发送」 */
  draftCount: number;
  /** R3-4:最新 Call 料记录 id(生成免登录确认链接用) */
  latestCallRecordId: string | null;
  /** R3-4:供应商经链接的回复(null=未回复;回复状态与邮件状态互不推导) */
  callReply: { canSupply: boolean; qty: string | null; eta: string | null } | null;
}

const TONE: Record<ShortageStatus, "red" | "amber" | "blue" | "green" | "gray"> = {
  OPEN: "red",
  CALL_CREATED: "amber",
  SENT_TO_SUPPLIER: "blue",
  PARTIALLY_RESOLVED: "amber",
  RESOLVED: "green",
};

export function ShortageSheetPanel({
  lines,
  canCall,
}: {
  lines: SheetLineView[];
  canCall: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ lineCount: number; errors: { row: number; message: string }[]; notices: string[] } | null>(null);
  const [callLink, setCallLink] = useState<{ lineId: string; url: string; note: string | null } | null>(null);

  async function genCallLink(lineId: string, recordId: string) {
    setBusy(`link:${recordId}`);
    setError(null);
    try {
      const res = await fetch(`/api/shortage/call-records/${recordId}/link`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { url?: string; note?: string | null; error?: string } | null;
      if (res.ok && body?.url) setCallLink({ lineId, url: body.url, note: body.note ?? null });
      else setError(body?.error ?? "生成失败");
    } finally {
      setBusy(null);
    }
  }

  async function upload(mode: "PREVIEW" | "EXECUTE") {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setError("请先选择缺料单文件");
      return;
    }
    setBusy(mode);
    setError(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("mode", mode);
      const res = await fetch("/api/shortage/sheets", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "导入失败");
        setPreview(body?.errors ? { lineCount: 0, errors: body.errors, notices: body.notices ?? [] } : null);
        return;
      }
      if (mode === "PREVIEW") {
        setPreview({ lineCount: body.lineCount, errors: body.errors ?? [], notices: body.notices ?? [] });
        setMsg(body.note);
      } else {
        setMsg(body.note);
        setPreview(null);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function call(lineId: string, shortageQty: string) {
    const qty = window.prompt(`Call 料数量(缺口 ${shortageQty}):`, shortageQty);
    if (!qty) return;
    setBusy(lineId);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/shortage/lines/${lineId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callQty: qty }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Call 料失败");
        return;
      }
      setMsg(body.note);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card title="① 导入缺料分析单" sub="xlsx / csv · 缺口以单据为准,系统不重算">
        <p className="small muted">
          必需列:<b>MPN</b>、<b>缺口数量</b>;可选:客户 / 内部料号 / 制造商 / 需求数量 /
          可用库存 / 在途 / 供应商 / ETA / 需求日期。
          <b>缺口数量以单据为准</b> —— 系统不拿库存缓存去改写业务已经认定的缺口。
        </p>
        <label className="fld">
          <span>选择文件</span>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.xls,.csv,.txt"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" disabled={busy !== null || !fileName} onClick={() => void upload("PREVIEW")}>
            {busy === "PREVIEW" ? "解析中…" : "预览"}
          </button>
          <button
            className="btn primary"
            disabled={busy !== null || !preview || preview.errors.length > 0}
            onClick={() => void upload("EXECUTE")}
          >
            {busy === "EXECUTE" ? "导入中…" : "执行导入"}
          </button>
        </div>
        {error ? (
          <div className="banner warn" role="alert" style={{ marginTop: 10 }}>
            {error}
          </div>
        ) : null}
        {msg ? (
          <div className="banner soft" style={{ marginTop: 10 }} data-testid="sheet-import-note">
            {msg}
          </div>
        ) : null}
        {preview ? (
          <div style={{ marginTop: 8 }} data-testid="sheet-preview">
            <div className="small">
              解析到 <b>{preview.lineCount}</b> 行
              {preview.errors.length > 0 ? (
                <Badge tone="red">{preview.errors.length} 处问题,全部修好才能导入</Badge>
              ) : null}
            </div>
            {preview.errors.slice(0, 20).map((e, i) => (
              <div key={i} className="small muted">
                第 {e.row} 行:{e.message}
              </div>
            ))}
            {preview.notices.map((n, i) => (
              <div key={i} className="small muted">
                {n}
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card
        title="② 缺料处理台"
        sub={`${lines.length} 行 · 按单据驱动;「已处理」为终态`}
        flush
      >
        <div className="tbl-scroll">
          <table className="tbl" data-testid="shortage-sheet-lines">
            <thead>
              {/* 客户点名:**不要位号**、**不要「建议采购」** */}
              <tr>
                <th>客户</th>
                <th>内部料号</th>
                <th>制造商</th>
                <th>MPN</th>
                <th className="num">需求</th>
                <th className="num">可用库存</th>
                <th className="num">在途</th>
                <th>供应商</th>
                <th>ETA</th>
                <th className="num">缺口</th>
                <th className="num">Call 数量</th>
                <th>需求日期</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={14} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    尚无缺料单 —— 请在上方导入
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.id}>
                    <td className="small">{l.customerName ?? "—"}</td>
                    <td className="small mono">{l.internalPn ?? "—"}</td>
                    <td className="small">{l.manufacturer ?? "—"}</td>
                    <td className="small">{l.mpn ?? "—"}</td>
                    <td className="num">{l.requiredQty}</td>
                    {/* 快照缺失显示「未知」而不是 0 */}
                    <td className="num">
                      {l.availableInventory === null ? <span className="muted">未知</span> : l.availableInventory}
                    </td>
                    <td className="num">
                      {l.openPoQty === null ? <span className="muted">未知</span> : l.openPoQty}
                    </td>
                    <td className="small">{l.supplierName ?? <span className="muted">未指定</span>}</td>
                    <td className="small">{l.eta ?? "—"}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {l.shortageQty}
                    </td>
                    <td className="num">{l.callQty ?? "—"}</td>
                    <td className="small">{l.requiredDate ?? "—"}</td>
                    <td>
                      <Badge tone={TONE[l.status]}>{SHORTAGE_STATUS_LABEL[l.status]}</Badge>
                      {l.draftCount > 0 && l.status === "CALL_CREATED" ? (
                        <div className="small muted" title="邮件通道未接通(SMTP 未配置)">
                          待发送 · 草稿 {l.draftCount}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {canCall && l.status === "OPEN" ? (
                        <button
                          className="btn xs"
                          disabled={busy !== null}
                          onClick={() => void call(l.id, l.shortageQty)}
                        >
                          Call 料
                        </button>
                      ) : null}
                      {canCall && l.latestCallRecordId && !l.callReply ? (
                        <button
                          className="btn xs"
                          disabled={busy !== null}
                          onClick={() => void genCallLink(l.id, l.latestCallRecordId!)}
                          data-testid={`call-link-${l.id}`}
                        >
                          确认链接
                        </button>
                      ) : null}
                      {l.callReply ? (
                        <div className="small" data-testid={`call-reply-${l.id}`}>
                          {l.callReply.canSupply
                            ? `供应商可供 ${l.callReply.qty ?? "?"}${l.callReply.eta ? ` · ${l.callReply.eta}` : ""}`
                            : "供应商回复:无法供应"}
                        </div>
                      ) : null}
                      {callLink?.lineId === l.id ? (
                        <div className="small" data-testid={`call-link-out-${l.id}`}>
                          链接(仅显示这一次):<code style={{ wordBreak: "break-all" }}>{callLink.url}</code>
                          {callLink.note ? <div className="muted">{callLink.note}</div> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ padding: "8px 16px" }}>
          Call 料后系统生成邮件草稿并记录到发送台账。
          <b>邮件通道尚未接通(SMTP 待客户提供),所以只会显示「待发送」,不会显示「已发送」</b>。
        </p>
      </Card>
    </>
  );
}
