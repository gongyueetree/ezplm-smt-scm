"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import type { RfqStatusValue } from "@/lib/domain/rfq-status";

interface TransitionOption {
  to: RfqStatusValue;
  label: string;
  requiresReason: boolean;
}

export function RfqActions({
  rfqId,
  transitions,
  readOnly,
  quoteQtys,
}: {
  rfqId: string;
  transitions: TransitionOption[];
  readOnly: boolean;
  quoteQtys: number[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachType, setAttachType] = useState("BOM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function transition(t: TransitionOption) {
    setError(null);
    setInfo(null);
    let reason: string | null = null;
    if (t.requiresReason) {
      reason = window.prompt(`流转到「${t.label}」必须填写原因:`);
      if (reason === null) return;
      if (!reason.trim()) {
        setError("原因不能为空");
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/rfq/${rfqId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: t.to, reason }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(body?.error ?? "流转失败");
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      setError("请先选择文件");
      return;
    }
    // FileList 是实时集合:清空 input 后 length 会归零,必须先取计数
    const selected = Array.from(files);
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const fd = new FormData();
      for (const f of selected) fd.append("files", f);
      fd.append("type", attachType);
      const res = await fetch(`/api/rfq/${rfqId}/attachments`, { method: "POST", body: fd });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) {
        if (fileRef.current) fileRef.current.value = "";
        setInfo(`已保存 ${selected.length} 个原始文件`);
        router.refresh();
        return;
      }
      setError(body?.error ?? "上传失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="操作" sub={quoteQtys.length ? `报价数量:${quoteQtys.join(" / ")}` : undefined}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {readOnly ? (
          <span className="small muted">当前状态为终态或当前角色无可执行流转。</span>
        ) : (
          transitions.map((t) => (
            <button
              key={t.to}
              className={`btn ${t.to === "CLOSED_NO_QUOTE" ? "" : "primary"}`}
              disabled={busy}
              onClick={() => transition(t)}
            >
              {t.to === "CLOSED_NO_QUOTE" ? "不报价并关闭" : `流转到 ${t.label}`}
            </button>
          ))
        )}
      </div>

      <div className="divider" />

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>附件类型</span>
          <select value={attachType} onChange={(e) => setAttachType(e.target.value)}>
            <option value="BOM">BOM</option>
            <option value="GERBER">Gerber</option>
            <option value="PDF">PDF</option>
            <option value="IMAGE">图片</option>
            <option value="PROCESS_DOC">工艺说明</option>
            <option value="OTHER">其它</option>
          </select>
        </label>
        <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 240 }}>
          <span>选择文件(可多选,保留原始客户文件)</span>
          <input ref={fileRef} type="file" multiple />
        </label>
        <button className="btn" disabled={busy} onClick={upload}>
          {busy ? "上传中…" : "上传附件"}
        </button>
      </div>

      {error ? (
        <div className="banner warn" style={{ marginTop: 12 }} role="alert">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="banner info" style={{ marginTop: 12 }} role="status">
          {info}
        </div>
      ) : null}
    </Card>
  );
}
