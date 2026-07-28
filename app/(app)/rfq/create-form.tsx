"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Card } from "@/components/ui/card";

export function CreateRfqForm({
  customers,
}: {
  customers: { id: string; name: string; code: string }[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [qtys, setQtys] = useState("100, 500, 1000");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const quoteQtys = qtys
        .split(/[,,\s]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      const res = await fetch("/api/rfq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          title,
          quoteQtys,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      const body = (await res.json().catch(() => null)) as { rfq?: { id: string }; error?: string } | null;
      if (res.ok && body?.rfq) {
        router.push(`/rfq/${body.rfq.id}`);
        router.refresh();
        return;
      }
      setError(body?.error ?? "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="新建 RFQ" sub="创建后可上传多个 BOM 与附件">
      <form onSubmit={submit}>
        <div className="grid-2">
          <label className="fld">
            <span>客户</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fld">
            <span>标题</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如:XX 控制板 SMT 加工询价"
              required
            />
          </label>
          <label className="fld">
            <span>报价数量(逗号分隔)</span>
            <input value={qtys} onChange={(e) => setQtys(e.target.value)} placeholder="100, 500, 1000" />
          </label>
          <label className="fld">
            <span>截止时间</span>
            <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </label>
        </div>
        {error ? (
          <div className="banner warn" role="alert">
            {error}
          </div>
        ) : null}
        <button className="btn primary" type="submit" disabled={busy || !customerId}>
          {busy ? "创建中…" : "创建 RFQ"}
        </button>
      </form>
    </Card>
  );
}
