"use client";

import { useState } from "react";

/** 连接自检 —— 只验证连接与鉴权,**不发任何邮件** */
export function MailVerify() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; note?: string } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings/mail", { method: "POST" });
      setResult(await res.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn" disabled={busy} onClick={() => void run()} data-testid="mail-verify">
        {busy ? "自检中…" : "连接自检(不发邮件)"}
      </button>
      {result ? (
        <div className={result.ok ? "banner soft" : "banner warn"} style={{ marginTop: 8 }} data-testid="mail-verify-result">
          {result.message}
          {result.note ? <div className="small muted">{result.note.replace(/\*\*/g, "")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
