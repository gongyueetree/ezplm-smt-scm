"use client";

/**
 * R3-4:为(询价单 × 供应商)生成免登录报价链接。
 * 原始 token 只显示这一次;供应商提交落 SupplierOffer(OFFLINE 报价池),
 * 正式比价与选择仍走下方采购人工流程。
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";

export function QuoteLinkGenerator({
  prfqId,
  suppliers,
}: {
  prfqId: string;
  suppliers: { id: string; name: string }[];
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ url: string; mpnCount: number; note: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      const res = await fetch(`/api/procurement/rfqs/${prfqId}/quote-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { url?: string; mpnCount?: number; note?: string | null; error?: string }
        | null;
      if (res.ok && body?.url) setOut({ url: body.url, mpnCount: body.mpnCount ?? 0, note: body.note ?? null });
      else setError(body?.error ?? "生成失败");
    } finally {
      setBusy(false);
    }
  }

  if (suppliers.length === 0) return null;

  return (
    <Card
      title="免登录报价链接(R3-4)"
      sub="供应商无需登录,填 单价/MOQ/SPQ/货期/有效期 → 落线下报价池(SupplierOffer);正式比价与选择仍走人工流程"
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="报价供应商">
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn" disabled={busy || !supplierId} onClick={() => void generate()} data-testid="gen-quote-link">
          {busy ? "生成中…" : "生成报价链接"}
        </button>
      </div>
      {error ? (
        <div className="banner warn" style={{ marginTop: 8 }} role="alert">
          {error}
        </div>
      ) : null}
      {out ? (
        <div className="small" style={{ marginTop: 8 }} data-testid="quote-link-out">
          覆盖 {out.mpnCount} 个 MPN。链接(仅显示这一次,请立即复制):<code>{out.url}</code>
          {out.note ? <div className="muted">{out.note}</div> : null}
        </div>
      ) : null}
    </Card>
  );
}
