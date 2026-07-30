"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";

export function CreateStatementForm({
  kind,
  customers,
  suppliers,
}: {
  kind: "AR" | "AP";
  customers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [tolerance, setTolerance] = useState("0.01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = kind === "AR" ? customers : suppliers;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          code: code.trim(),
          customerId: kind === "AR" ? counterparty || null : null,
          supplierId: kind === "AP" ? counterparty || null : null,
          currency,
          amountTolerance: tolerance,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `创建失败(HTTP ${res.status})`);
        return;
      }
      router.push(`/reconciliation/${body.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Card title="新建对账单" sub={kind === "AR" ? "对客户" : "对供应商"}>
        <button className="btn primary" onClick={() => setOpen(true)}>
          新建对账单
        </button>
      </Card>
    );
  }

  return (
    <Card title="新建对账单" sub="建单后在详情页粘贴对方对账单并执行匹配">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>对账单号</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="REC-2026-07" />
        </label>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>{kind === "AR" ? "客户" : "供应商"}</span>
          <select value={counterparty} onChange={(e) => setCounterparty(e.target.value)}>
            <option value="">未指定</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>币种</span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            style={{ width: 80 }}
          />
        </label>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>金额容差</span>
          <input value={tolerance} onChange={(e) => setTolerance(e.target.value)} style={{ width: 90 }} />
        </label>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        容差是<b>口径</b>而不是魔法数:缺省一分钱,尾差在容差内判一致。改动会记入对账单快照。
      </p>
      {error ? (
        <div className="banner warn" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn primary" disabled={busy || !code.trim()} onClick={() => void submit()}>
          {busy ? "创建中…" : "创建"}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </Card>
  );
}
