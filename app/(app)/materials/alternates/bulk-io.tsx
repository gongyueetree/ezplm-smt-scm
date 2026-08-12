"use client";

/**
 * E3:替代料批量导入 / 导出(客户 Q9 点名要「输入口」)。
 *
 * 入口放在替代料页的**显眼位置**,不埋进二级页面 ——
 * 客户上一轮的反馈就是"功能都在,但找不到入口"。
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Preview {
  total: number;
  ok: number;
  failed: number;
  errors: { rowNo: number; message: string }[];
  errorsTruncated: boolean;
  scanNote: string | null;
}

export function AlternateBulkIo() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowPartial, setAllowPartial] = useState(false);
  const [executed, setExecuted] = useState(false);

  async function send(execute: boolean) {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("请先选择文件");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("execute", String(execute));
      fd.append("allowPartial", String(allowPartial));
      const res = await fetch("/api/materials/alternates/bulk-import", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (body?.preview) setPreview(body.preview);
      if (!res.ok) {
        setError(body?.error ?? `导入失败(HTTP ${res.status})`);
        return;
      }
      setExecuted(Boolean(body.executed));
      setNote(body.note ?? null);
      if (body.executed) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="alternate-bulk-io">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
          <span>选择文件(xlsx / csv)</span>
          <input ref={fileRef} type="file" aria-label="替代料导入文件" />
        </label>
        <button className="btn" disabled={busy} onClick={() => void send(false)} data-testid="alt-preview">
          {busy ? "处理中…" : "预览校验"}
        </button>
        <button
          className="btn primary"
          disabled={busy || !preview}
          onClick={() => void send(true)}
          data-testid="alt-execute"
        >
          执行导入
        </button>
        <a className="btn" href="/api/materials/alternates/export?template=1" data-testid="alt-template">
          下载导入模板
        </a>
        <a className="btn" href="/api/materials/alternates/export" data-testid="alt-export">
          导出替代关系
        </a>
      </div>

      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input
          type="checkbox"
          aria-label="只导入通过校验的行"
          checked={allowPartial}
          onChange={(e) => setAllowPartial(e.target.checked)}
        />
        只导入通过校验的行(默认<b>有坏行就整批不执行</b> —— 半批导入会让人以为全导进去了)
      </label>

      <p className="small muted" style={{ marginTop: 6 }}>
        导出的表<b>就是导入模板的格式</b>,导出改一改可以直接导回来。
        三个兼容维度均为必填,不确定请显式填 <code>UNKNOWN</code> ——
        留空会被拒绝,<b>系统不替你猜</b>。
        基准料与替代料都必须已存在于物料库,<b>导入不会自动建料</b>。
      </p>

      {error ? (
        <div className="banner warn" role="alert" data-testid="alt-error">
          {error}
        </div>
      ) : null}
      {note ? (
        <div className="banner soft" data-testid="alt-note">
          {note}
        </div>
      ) : null}

      {preview ? (
        <div style={{ marginTop: 8 }} data-testid="alt-preview-result">
          <div className="small">
            共 <b>{preview.total}</b> 行 · 通过 <b>{preview.ok}</b> · 未通过{" "}
            <b style={{ color: preview.failed > 0 ? "var(--danger)" : undefined }}>{preview.failed}</b>
            {!executed ? <span className="muted">(尚未写入)</span> : null}
          </div>
          {preview.scanNote ? <div className="banner warn">{preview.scanNote}</div> : null}
          {preview.errors.length > 0 ? (
            <div className="tbl-scroll" style={{ maxHeight: 240, marginTop: 6 }}>
              <table className="tbl" data-testid="alt-errors">
                <thead>
                  <tr>
                    <th className="num">行号</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.errors.map((e, i) => (
                    <tr key={`${e.rowNo}-${i}`}>
                      <td className="num">{e.rowNo}</td>
                      <td className="small">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {preview.errorsTruncated ? (
            <p className="small muted">错误较多,只列出前 200 条。</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
