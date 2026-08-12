"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = [
  { v: "INCOMING", label: "来料异常" },
  { v: "PROCESS", label: "过程异常" },
  { v: "CUSTOMER_COMPLAINT", label: "客户投诉" },
  { v: "SUPPLIER", label: "供应商问题" },
  { v: "TRACE_INCIDENT", label: "追溯事件" },
  { v: "OTHER", label: "其它" },
];

export function QualityForm({
  customers,
  suppliers,
}: {
  customers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("INCOMING");
  const [customerId, setCustomerId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [mpn, setMpn] = useState("");
  const [lotId, setLotId] = useState("");
  const [sn, setSn] = useState("");
  const [description, setDescription] = useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/quality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          eventType,
          customerId: customerId || null,
          supplierId: supplierId || null,
          mpn: mpn || null,
          lotId: lotId || null,
          sn: sn || null,
          description: description || null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `登记失败(HTTP ${res.status})`);
        return;
      }
      setNote(body.note ?? "已记录");
      setTitle("");
      setSn("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="quality-form">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>类型</span>
          <select aria-label="事件类型" value={eventType} onChange={(e) => setEventType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
          <span>标题</span>
          <input aria-label="事件标题" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>客户(客诉必填)</span>
          <select aria-label="关联客户" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">未选择</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>供应商(供应商问题必填)</span>
          <select aria-label="关联供应商" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">未选择</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>MPN</span>
          <input aria-label="MPN" value={mpn} onChange={(e) => setMpn(e.target.value)} />
        </label>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>批次号</span>
          <input aria-label="批次号" value={lotId} onChange={(e) => setLotId(e.target.value)} />
        </label>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>SN(有才填)</span>
          <input aria-label="SN" value={sn} onChange={(e) => setSn(e.target.value)} placeholder="没有 MES 通常留空" />
        </label>
        <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
          <span>说明</span>
          <input aria-label="说明" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || !title.trim()} onClick={() => void submit()} data-testid="quality-submit">
          {busy ? "登记中…" : "登记"}
        </button>
      </div>

      <p className="small muted" style={{ marginTop: 6 }}>
        <b>SN 留空是常态</b> —— 本系统不产生 SN,SN 级追溯依赖 MES 接入。
        这里填的 SN 属人工录入,不代表系统能按 SN 追溯全链路。
      </p>

      {error ? (
        <div className="banner warn" role="alert" data-testid="quality-error">
          {error}
        </div>
      ) : null}
      {note ? (
        <div className="banner soft" data-testid="quality-note">
          {note}
        </div>
      ) : null}
    </div>
  );
}
