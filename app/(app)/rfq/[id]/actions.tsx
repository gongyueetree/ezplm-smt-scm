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
  /**
   * E1b:逐文件上传进度。
   *
   * 用 XHR 而不是 fetch —— fetch **没有上传进度事件**。
   * 没有进度条时,一个 80MB 的 Gerber 包在界面上就是"点了没反应",
   * 用户只会认为死机了;这本身就是客户反馈的一部分。
   */
  const [uploads, setUploads] = useState<
    { name: string; percent: number; state: "uploading" | "done" | "failed" | "canceled"; error?: string }[]
  >([]);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

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

  /** 单个文件流式上传;返回是否成功 */
  function uploadOne(file: File, index: number): Promise<boolean> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      // 走 /api/upload/(middleware 已排除)—— 否则 body 会在 10MB 处被静默截断
      const q = new URLSearchParams({ rfqId, name: file.name, type: attachType });
      xhr.open("POST", `/api/upload/rfq-attachment?${q.toString()}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const percent = Math.round((e.loaded / e.total) * 100);
        setUploads((u) => u.map((x, i) => (i === index ? { ...x, percent } : x)));
      };
      xhr.onload = () => {
        const ok = xhr.status >= 200 && xhr.status < 300;
        let message = `上传失败(HTTP ${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* 响应不是 JSON 时保留默认文案 */
        }
        setUploads((u) =>
          u.map((x, i) =>
            i === index
              ? { ...x, percent: ok ? 100 : x.percent, state: ok ? "done" : "failed", error: ok ? undefined : message }
              : x,
          ),
        );
        resolve(ok);
      };
      xhr.onerror = () => {
        setUploads((u) =>
          u.map((x, i) => (i === index ? { ...x, state: "failed", error: "网络中断" } : x)),
        );
        resolve(false);
      };
      xhr.onabort = () => {
        setUploads((u) => u.map((x, i) => (i === index ? { ...x, state: "canceled" } : x)));
        resolve(false);
      };
      xhr.send(file);
    });
  }

  /**
   * 逐个上传,不并发。
   *
   * 并发看起来快,但十个大包同时压过去,服务端要同时扛十份流 ——
   * 而我们要解决的正是"扛不住"。顺序上传还有一个好处:
   * 第 5 个失败时,前 4 个已经**真的存下来了**,不用整批重来。
   */
  async function upload() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      setError("请先选择文件");
      return;
    }
    const selected = Array.from(files);
    setBusy(true);
    setError(null);
    setInfo(null);
    setUploads(selected.map((f) => ({ name: f.name, percent: 0, state: "uploading" as const })));
    try {
      let ok = 0;
      for (const [i, f] of selected.entries()) {
        if (await uploadOne(f, i)) ok += 1;
      }
      if (fileRef.current && ok === selected.length) fileRef.current.value = "";
      setInfo(
        ok === selected.length
          ? `已保存 ${ok} 个原始文件。系统**未解析**这些文件 —— 保存成功不代表读懂了内容。`
          : `${ok}/${selected.length} 个文件已保存;失败的可单独重试,已成功的不必重传。`,
      );
      router.refresh();
    } finally {
      xhrRef.current = null;
      setBusy(false);
    }
  }

  async function retryOne(index: number) {
    const file = fileRef.current?.files?.[index];
    if (!file) {
      setError("原文件已不在选择框里,请重新选择后再试");
      return;
    }
    setBusy(true);
    setUploads((u) => u.map((x, i) => (i === index ? { ...x, percent: 0, state: "uploading", error: undefined } : x)));
    try {
      await uploadOne(file, index);
      router.refresh();
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
        {busy ? (
          <button className="btn" onClick={() => xhrRef.current?.abort()} data-testid="upload-cancel">
            取消当前文件
          </button>
        ) : null}
      </div>

      {uploads.length > 0 ? (
        <div style={{ marginTop: 10 }} data-testid="upload-progress">
          {uploads.map((u, i) => (
            <div key={`${u.name}-${i}`} className="small" style={{ marginBottom: 4 }}>
              <span>{u.name}</span>{" "}
              {u.state === "uploading" ? (
                <span className="muted">上传中 {u.percent}%</span>
              ) : u.state === "done" ? (
                <span className="badge green">已保存 · 未解析</span>
              ) : u.state === "canceled" ? (
                <span className="badge gray">已取消</span>
              ) : (
                <>
                  <span className="badge red">失败</span>{" "}
                  <span className="muted">{u.error}</span>{" "}
                  <button className="btn xs" onClick={() => void retryOne(i)} disabled={busy}>
                    重试
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}

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
