"use client";

/**
 * 物料文档:上传 + 有效期登记 + 到期预警。
 *
 * 纪律:**未填有效期 ≠ 长期有效** —— 显示为「未标注有效期」并按告警配色,
 * 促使人去补,而不是安静地当成没问题。
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DOC_KIND_LABEL, expiryBucket, expiryTone, daysUntilExpiry } from "@/lib/domain/doc-expiry";

interface Doc {
  id: string;
  kind: string;
  kindLabel: string;
  fileName: string;
  sizeBytes: number | null;
  version: string | null;
  validUntil: string | null;
  source: string;
  createdAt: string;
}

const KINDS = ["DATASHEET", "APPROVAL_SHEET", "ROHS_REPORT", "REACH_REPORT", "COC", "OTHER"] as const;

export function PartDocuments({ partId, canUpload }: { partId: string | null; canUpload: boolean }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [kind, setKind] = useState<string>("DATASHEET");
  const [validUntil, setValidUntil] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!partId) return;
    void fetch(`/api/materials/parts/${partId}/documents`)
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((b) => setDocs(b.documents ?? []));
  }, [partId]);

  async function upload(file: File) {
    if (!partId) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      if (validUntil) form.append("validUntil", validUntil);
      if (version) form.append("version", version);
      const res = await fetch(`/api/materials/parts/${partId}/documents`, { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `上传失败(HTTP ${res.status})`);
        return;
      }
      if (body.note) setNote(body.note);
      const list = await fetch(`/api/materials/parts/${partId}/documents`).then((r) => r.json());
      setDocs(list.documents ?? []);
      setValidUntil("");
      setVersion("");
    } finally {
      setBusy(false);
    }
  }

  const asOf = new Date().toISOString();

  if (!partId) {
    return (
      <Card title="文档与合规" sub="需先在本地物料库建档">
        <p className="small muted">
          该型号尚未在本系统建档(可能只存在于 ezPLM 缓存)—— 文档上传需要本地物料记录。
        </p>
      </Card>
    );
  }

  return (
    <Card title="文档与合规" sub={`${docs.length} 份 · 未填有效期不视为长期有效`} flush>
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>类型</th>
              <th>文件</th>
              <th>版本</th>
              <th>有效期</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                  暂无文档 —— 没有 RoHS / REACH / COC 记录,不等于该料合规
                </td>
              </tr>
            ) : (
              docs.map((d) => {
                const bucket = expiryBucket(d.validUntil, asOf);
                const days = daysUntilExpiry(d.validUntil, asOf);
                return (
                  <tr key={d.id}>
                    <td className="small">{DOC_KIND_LABEL[d.kind] ?? d.kindLabel}</td>
                    <td className="small">{d.fileName}</td>
                    <td className="small muted">{d.version ?? "—"}</td>
                    <td className="small">
                      <Badge tone={expiryTone(bucket)}>{bucket}</Badge>
                      {d.validUntil ? (
                        <div className="muted">
                          {d.validUntil.slice(0, 10)}
                          {days !== null ? (days < 0 ? ` · 已过期 ${-days} 天` : ` · 还剩 ${days} 天`) : ""}
                        </div>
                      ) : (
                        <div className="muted">未填 —— 请补登有效期</div>
                      )}
                    </td>
                    <td className="small muted">{d.source}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {canUpload ? (
        <div style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="fld" style={{ marginBottom: 0 }}>
              <span>类型</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DOC_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld" style={{ marginBottom: 0 }}>
              <span>有效期(留空=未标注)</span>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </label>
            <label className="fld" style={{ marginBottom: 0 }}>
              <span>版本</span>
              <input value={version} onChange={(e) => setVersion(e.target.value)} style={{ width: 110 }} />
            </label>
            <label className="fld" style={{ marginBottom: 0 }}>
              <span>选择文件(≤10MB)</span>
              <input
                type="file"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
            </label>
          </div>
          {note ? (
            <div className="banner soft" style={{ marginTop: 8 }}>
              {note}
            </div>
          ) : null}
          {error ? (
            <div className="banner warn" style={{ marginTop: 8 }} data-testid="doc-error">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
