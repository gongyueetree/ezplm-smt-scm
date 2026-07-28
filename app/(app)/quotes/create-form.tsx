"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { BUILTIN_LABOR_TEMPLATES } from "@/lib/domain/quote-calc";

export function CreateQuoteForm({
  rfqs,
}: {
  rfqs: { id: string; code: string; title: string; customerId: string }[];
}) {
  const router = useRouter();
  const [rfqId, setRfqId] = useState(rfqs[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(BUILTIN_LABOR_TEMPLATES[0].id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const rfq = rfqs.find((r) => r.id === rfqId);
    if (!rfq) {
      setError("请选择 RFQ");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rfqId: rfq.id,
          customerId: rfq.customerId,
          laborTemplateId: templateId,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { version?: { id: string }; error?: string }
        | null;
      if (res.ok && body?.version) {
        router.push(`/quotes/${body.version.id}`);
        router.refresh();
        return;
      }
      setError(body?.error ?? "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="新建报价" sub="从 RFQ 建立 Revision 1(草稿)">
      <form onSubmit={submit}>
        <div className="grid-2">
          <label className="fld">
            <span>来源 RFQ</span>
            <select value={rfqId} onChange={(e) => setRfqId(e.target.value)} required>
              {rfqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.title}
                </option>
              ))}
            </select>
          </label>
          <label className="fld">
            <span>人工费率模板</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {BUILTIN_LABOR_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? (
          <div className="banner warn" role="alert">
            {error}
          </div>
        ) : null}
        <button className="btn primary" type="submit" disabled={busy || rfqs.length === 0}>
          {busy ? "创建中…" : "创建报价"}
        </button>
        {rfqs.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            尚无 RFQ,请先在「RFQ 询价」创建。
          </p>
        ) : null}
      </form>
    </Card>
  );
}
