"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** F4:人工重试。幂等键复用原值 —— 断网单据重试拿回原单,不重复建。 */
export function RetryButton({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/integration/sync-records/${recordId}/retry`, { method: "POST" });
      const body = (await res.json()) as { ok: boolean; state: string; reason?: string };
      setMsg(body.ok ? `已重试:${body.state}` : body.reason ?? `失败:${body.state}`);
      router.refresh();
    } catch {
      setMsg("请求失败,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="btn" onClick={retry} disabled={busy} data-testid="sync-retry-btn">
        {busy ? "重试中…" : "重试"}
      </button>
      {msg && <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>{msg}</span>}
    </span>
  );
}
