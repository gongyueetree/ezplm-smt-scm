"use client";

/**
 * E4:预 BOM 批量导入 / 导出(客户 Q9)。
 *
 * 入口放在 BOM 台账页顶部 —— 客户上一轮的抱怨就是"功能都在但找不到入口"。
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface FileResult {
  fileName: string;
  ok: boolean;
  reason: string | null;
  bomVersionId: string | null;
  jobId: string | null;
  lines: number;
  reconciliation: {
    totalRows: number;
    recognized: number;
    needsReview: number;
    balanced: boolean;
  } | null;
  idempotentHit: boolean;
}

export function PreBomBulk({ selectableBoms }: { selectableBoms: { id: string; label: string }[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  async function importBatch() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      setError("请先选择文件(可多选)");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch("/api/bom/import/batch", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `批量导入失败(HTTP ${res.status})`);
        return;
      }
      setResults(body.results ?? []);
      setNote(body.note ?? null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="pre-bom-bulk">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 240 }}>
          <span>选择多个 BOM 文件(xls / xlsx / csv / PDF / 图片)</span>
          <input ref={fileRef} type="file" multiple aria-label="预 BOM 批量导入文件" />
        </label>
        <button className="btn primary" disabled={busy} onClick={() => void importBatch()} data-testid="pre-bom-import">
          {busy ? "导入中…" : "批量导入预 BOM"}
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        <b>每个文件各自生成一份 BOM</b>(用途固定为<b>预 BOM</b>),互不合并 ——
        一次失败不影响其它文件。正式 BOM 只能由预 BOM<b>转换</b>生成,批量导入不是绕过它的后门。
        PDF / 图片仍走既有的识别流程,<b>没有第二套解析器</b>。
      </p>

      {error ? (
        <div className="banner warn" role="alert" data-testid="pre-bom-error">
          {error}
        </div>
      ) : null}
      {note ? (
        <div className="banner soft" data-testid="pre-bom-note">
          {note}
        </div>
      ) : null}

      {results ? (
        <div className="tbl-scroll" style={{ marginTop: 8, maxHeight: 300 }}>
          <table className="tbl" data-testid="pre-bom-results">
            <thead>
              <tr>
                <th>文件</th>
                <th>结果</th>
                <th className="num">导入行数</th>
                <th className="num">原始行 / 待人工</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.fileName}>
                  <td className="small">{r.fileName}</td>
                  <td>
                    <span className={r.ok ? "badge green" : "badge red"}>{r.ok ? "已导入" : "失败"}</span>
                  </td>
                  <td className="num">{r.lines}</td>
                  <td className="num small">
                    {r.reconciliation
                      ? `${r.reconciliation.totalRows} / ${r.reconciliation.needsReview}`
                      : "-"}
                  </td>
                  <td className="small muted">
                    {r.reason ?? (r.idempotentHit ? "内容与既有版本相同,复用原版本(未新建)" : "")}
                    {r.ok && r.jobId ? (
                      <>
                        {" "}
                        <Link href={`/bom/imports/${r.jobId}`}>行去向</Link>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="divider" />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="fld" style={{ marginBottom: 0, minWidth: 260 }}>
          <span>选择要导出的 BOM(可多选)</span>
          <select
            multiple
            size={5}
            aria-label="批量导出 BOM 选择"
            value={picked}
            onChange={(e) => setPicked(Array.from(e.target.selectedOptions).map((o) => o.value))}
          >
            {selectableBoms.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <a
          className={picked.length === 0 ? "btn disabled" : "btn"}
          href={picked.length === 0 ? "#" : `/api/bom/export?ids=${picked.join(",")}`}
          data-testid="pre-bom-export"
          aria-disabled={picked.length === 0}
        >
          批量导出预 BOM({picked.length})
        </a>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        导出保留<b>客户原始料号 / 描述 / 制造商 / MPN / 数量</b>,
        并附<b>导入状态与待人工判断行数</b> —— 后者不为 0 表示这份 BOM 还有内容没人认领,
        <b>导出的不等于干净数据</b>。
      </p>
    </div>
  );
}
