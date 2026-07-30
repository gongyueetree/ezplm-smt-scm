"use client";

/**
 * BOM 版本页的两个入口(都是客户点名"缺 button"的):
 * - 标准模板 BOM 一键导出;
 * - BOM → 报价一键转化(rfqId / customerId 从 BOM 自动带入,不再让人手填)。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export function VersionActions({
  versionId,
  allConfirmed,
}: {
  versionId: string;
  allConfirmed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function toQuote() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/bom/version/${versionId}/to-quote`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `生成报价失败(HTTP ${res.status})`);
        return;
      }
      if (body.note) setNote(body.note);
      router.push(`/quotes/${body.quoteVersionId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a className="btn" href={`/api/bom/version/${versionId}/export`}>
          导出标准模板 BOM
        </a>
        <button className="btn primary" disabled={busy} onClick={() => void toQuote()}>
          {busy ? "生成中…" : "生成报价单"}
        </button>
      </div>
      {!allConfirmed ? (
        <p className="small muted" style={{ marginTop: 6 }}>
          生成报价只会取<b>已人工确认</b>的匹配行;未确认的行不会进报价。
        </p>
      ) : null}
      {error ? (
        <div className="banner warn" style={{ marginTop: 8 }} data-testid="bom-action-error">
          {error}
        </div>
      ) : null}
      {note ? (
        <div className="banner soft" style={{ marginTop: 8 }}>
          {note}
        </div>
      ) : null}
    </div>
  );
}
