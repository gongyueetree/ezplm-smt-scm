"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { BomIssue } from "@/lib/domain/bom-validate";

interface ImportResponse {
  job: { id: string; totalLines: number; processedLines: number; batchSize: number };
  bomVersionId: string;
  validation: { issues: BomIssue[]; errorCount: number; warningCount: number; blocked: boolean };
  mapping: { fields: Record<string, number>; headerRowIndex: number; confidence: number; unmapped: { header: string }[] };
  uniqueMpns: number;
  usesBatching: boolean;
  archivedOnly: string[];
}

interface Progress {
  total: number;
  processed: number;
  percent: number;
  done: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  refDes: "位号",
  qty: "数量",
  mpn: "MPN",
  manufacturer: "制造商",
  customerPn: "客户料号",
  internalPn: "内部料号",
  description: "描述",
  footprint: "封装",
};

export function ImportWizard({ rfqs }: { rfqs: { id: string; code: string; title: string }[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rfqId, setRfqId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [degraded, setDegraded] = useState<{ provider: string; kind: string; message: string }[]>([]);

  async function upload() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      setError("请先选择文件");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);
    setDegraded([]);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      if (rfqId) fd.append("rfqId", rfqId);
      const res = await fetch("/api/bom/import", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "导入失败");
        return;
      }
      setResult(body as ImportResponse);
      await runMatching((body as ImportResponse).job.id);
    } finally {
      setBusy(false);
    }
  }

  /** 拉取式推进:逐批调用直到完成(与 SSE 端点同一套后端逻辑) */
  async function runMatching(jobId: string) {
    for (let i = 0; i < 200; i++) {
      const res = await fetch(`/api/bom/import/${jobId}`);
      if (!res.ok) {
        setError("匹配进度获取失败");
        return;
      }
      const body = (await res.json()) as {
        progress: Progress;
        degraded: { provider: string; kind: string; message: string }[];
      };
      setProgress(body.progress);
      if (body.degraded.length > 0) {
        setDegraded((prev) => [...prev, ...body.degraded]);
      }
      if (body.progress.done) return;
    }
  }

  return (
    <div>
      <Card title="① 上传 BOM 文件">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="fld" style={{ marginBottom: 0, minWidth: 220 }}>
            <span>关联 RFQ(可选)</span>
            <select value={rfqId} onChange={(e) => setRfqId(e.target.value)}>
              <option value="">不关联</option>
              {rfqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.title}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
            <span>选择文件(可多选)</span>
            <input ref={fileRef} type="file" multiple />
          </label>
          <button className="btn primary" onClick={upload} disabled={busy}>
            {busy ? "处理中…" : "开始导入"}
          </button>
        </div>
        {error ? (
          <div className="banner warn" style={{ marginTop: 12 }} role="alert">
            {error}
          </div>
        ) : null}
      </Card>

      {result ? (
        <>
          <Card
            title="② 列映射识别结果"
            sub={`表头第 ${result.mapping.headerRowIndex + 1} 行 · 置信度 ${(result.mapping.confidence * 100).toFixed(0)}%`}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(result.mapping.fields).map(([field, col]) => (
                <Badge key={field} tone="green">
                  {FIELD_LABELS[field] ?? field} → 第 {col + 1} 列
                </Badge>
              ))}
              {result.mapping.unmapped.map((u, i) => (
                <Badge key={`u-${i}`} tone="gray">
                  未识别:{u.header}
                </Badge>
              ))}
            </div>
          </Card>

          <Card
            title="③ 导入校验"
            sub={`${result.job.totalLines} 行 · ${result.uniqueMpns} 个唯一 MPN · ${result.validation.errorCount} 错误 / ${result.validation.warningCount} 提示`}
          >
            {result.archivedOnly.length > 0 ? (
              <div className="banner warn">
                以下文件仅归档,未做自动识别(OCR 属二期):{result.archivedOnly.join("、")}
              </div>
            ) : null}
            {result.validation.issues.length === 0 ? (
              <p className="small muted">未发现问题。</p>
            ) : (
              <ul className="small" style={{ lineHeight: 1.9, paddingLeft: 18 }}>
                {result.validation.issues.slice(0, 50).map((i, idx) => (
                  <li key={idx}>
                    <Badge tone={i.level === "error" ? "red" : "amber"}>{i.level === "error" ? "错误" : "提示"}</Badge>{" "}
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="④ 智能匹配进度"
            sub={result.usesBatching ? `分批处理,每批 ${result.job.batchSize} 行` : "行数较少,单批完成"}
          >
            {progress ? (
              <div>
                <div
                  style={{
                    height: 10,
                    background: "var(--gray-150)",
                    borderRadius: 999,
                    overflow: "hidden",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      width: `${progress.percent}%`,
                      height: "100%",
                      background: progress.done ? "var(--brand)" : "var(--ai)",
                      transition: "width 200ms",
                    }}
                  />
                </div>
                <p className="small muted">
                  {progress.processed} / {progress.total} 行 · {progress.percent}%
                  {progress.done ? " · 已完成" : " · 进行中"}
                </p>
              </div>
            ) : (
              <p className="small muted">等待开始…</p>
            )}

            {degraded.length > 0 ? (
              <div className="banner warn" style={{ marginTop: 12 }}>
                <span>
                  <b>外部数据源降级</b>(不影响其余候选):
                  {degraded.slice(0, 3).map((d, i) => (
                    <span key={i}>
                      {" "}
                      {d.provider}/{d.kind}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}

            {progress?.done ? (
              <div style={{ marginTop: 14 }}>
                <Link className="btn primary" href={`/bom/version/${result.bomVersionId}`}>
                  进入匹配确认(需人工确认)
                </Link>
              </div>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
