"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";

/** F2:创建 ECN(发起人 PM/工程/管理层) */
export function CreateEcnForm({ customers }: { customers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState("DESIGN_CHANGE");
  const [priority, setPriority] = useState("MEDIUM");
  const [customerId, setCustomerId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ecn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          type,
          priority,
          customerId: customerId || null,
          reason: reason || null,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ecnId?: string; error?: string } | null;
      if (res.ok && body?.ecnId) {
        router.push(`/ecn/${body.ecnId}`);
        router.refresh();
        return;
      }
      setError(body?.error ?? "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="发起 ECN" sub="创建后为草稿;补齐变更行再提交评审">
      <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="fld" style={{ minWidth: 240 }}>
          <span>标题 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="ECN 标题" required />
        </label>
        <label className="fld">
          <span>类型</span>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="ECN 类型">
            <option value="DESIGN_CHANGE">设计变更</option>
            <option value="EOL_REPLACEMENT">EOL 替换</option>
            <option value="PROCESS_CHANGE">工艺变更</option>
            <option value="DOC_CHANGE">文档变更</option>
            <option value="OTHER">其它</option>
          </select>
        </label>
        <label className="fld">
          <span>优先级</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="优先级">
            <option value="LOW">低</option>
            <option value="MEDIUM">中</option>
            <option value="HIGH">高</option>
            <option value="URGENT">紧急</option>
          </select>
        </label>
        <label className="fld">
          <span>客户(可选)</span>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="客户">
            <option value="">—</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fld" style={{ minWidth: 260 }}>
          <span>变更原因</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="变更原因" />
        </label>
        <button className="btn primary" type="submit" disabled={busy || !title.trim()} data-testid="ecn-create">
          {busy ? "创建中…" : "创建 ECN"}
        </button>
      </form>
      {error ? (
        <div className="banner warn" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
    </Card>
  );
}
