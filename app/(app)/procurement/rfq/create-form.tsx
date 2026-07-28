"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Card } from "@/components/ui/card";

export function CreateProcurementRfqForm({
  versions,
}: {
  versions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"SPOT" | "FUTURES">("SPOT");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (selected.length === 0) {
      setError("至少选择一个 BOM 版本");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/procurement/rfq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bomVersionIds: selected, sourcingMode: mode }),
      });
      const body = (await res.json().catch(() => null)) as
        | { procurementRfq?: { id: string }; error?: string }
        | null;
      if (res.ok && body?.procurementRfq) {
        router.push(`/procurement/rfq/${body.procurementRfq.id}`);
        router.refresh();
        return;
      }
      setError(body?.error ?? "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="新建采购 RFQ" sub="接收 PM 的一个或多个 BOM(原始客户 BOM 保留在 BOM 侧,不复制)">
      <form onSubmit={submit}>
        <label className="fld">
          <span>BOM 版本(可多选)</span>
          <select
            multiple
            size={Math.min(5, Math.max(3, versions.length))}
            value={selected}
            onChange={(e) => setSelected(Array.from(e.target.selectedOptions, (o) => o.value))}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>询价模式</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as "SPOT" | "FUTURES")}>
            <option value="SPOT">现货(要求库存覆盖采购量)</option>
            <option value="FUTURES">期货(允许零库存,但必须有交期)</option>
          </select>
        </label>
        {error ? (
          <div className="banner warn" role="alert">
            {error}
          </div>
        ) : null}
        <button className="btn primary" type="submit" disabled={busy || versions.length === 0}>
          {busy ? "创建中…" : "创建采购 RFQ"}
        </button>
        {versions.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            尚无 BOM 版本,请先在「BOM 导入」导入 BOM。
          </p>
        ) : null}
      </form>
    </Card>
  );
}
