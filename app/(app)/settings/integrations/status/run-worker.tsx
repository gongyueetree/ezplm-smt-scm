"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** closed-loop P0-7:手动跑一轮 ETA 回写 worker(定时轮走 /api/cron/integration-worker) */
export function RunWorkerButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integration/worker/run", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(body?.error ?? "触发失败");
        return;
      }
      setMsg(`扫描 ${body.scanned} · 成功 ${body.synced} · 待重试 ${body.retryRequired} · 阻断 ${body.blocked} · 失败 ${body.failed}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button className="btn" disabled={busy} onClick={() => void run()} data-testid="run-worker-btn">
        {busy ? "执行中…" : "处理待回写(ETA)"}
      </button>
      {msg ? <span className="small muted" style={{ marginLeft: 6 }} data-testid="run-worker-msg">{msg}</span> : null}
    </span>
  );
}
