"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 把本次比对存入台账(客户:历史快照留存,下次不用重新选版本) */
export function SaveCompareRun({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bom/compare-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromVersionId: from, toVersionId: to }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `保存失败(HTTP ${res.status})`);
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" disabled={busy || saved} onClick={() => void save()}>
        {busy ? "保存中…" : saved ? "已存入台账" : "保存本次比对到台账"}
      </button>
      <span className="small muted">
        存的是<b>当时的差异快照</b>;两个版本之后再改也不影响这条记录。
      </span>
      {error ? (
        <span className="small" style={{ color: "var(--danger)" }} data-testid="compare-save-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
