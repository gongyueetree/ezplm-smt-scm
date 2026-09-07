"use client";

/**
 * F3:按供应商生成免登录交期确认链接。
 * 原始 token 只显示这一次;发送状态与确认状态互不推导(确认落 OPOReply source=LINK)。
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";

export function EtaLinkGenerator({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ url: string; openLines: number; note: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      const res = await fetch("/api/opo/eta-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { url?: string; openLines?: number; note?: string | null; error?: string }
        | null;
      if (res.ok && body?.url) setOut({ url: body.url, openLines: body.openLines ?? 0, note: body.note ?? null });
      else setError(body?.error ?? "生成失败");
    } finally {
      setBusy(false);
    }
  }

  if (suppliers.length === 0) return null;

  return (
    <Card
      title="免登录交期确认链接(F3)"
      sub="供应商无需登录,打开链接即可逐行回复交期;回复落 OPOReply(来源=LINK),ERP 回写另行人工触发"
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="选择供应商">
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn" disabled={busy || !supplierId} onClick={() => void generate()} data-testid="gen-eta-link">
          {busy ? "生成中…" : "生成确认链接"}
        </button>
      </div>
      {error ? (
        <div className="banner warn" style={{ marginTop: 8 }} role="alert">
          {error}
        </div>
      ) : null}
      {out ? (
        <div className="small" style={{ marginTop: 8 }} data-testid="eta-link-out">
          覆盖 {out.openLines} 个未交行。链接(仅显示这一次,请立即复制):<code>{out.url}</code>
          {out.note ? <div className="muted">{out.note}</div> : null}
        </div>
      ) : null}
    </Card>
  );
}
