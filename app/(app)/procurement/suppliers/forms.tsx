"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Card } from "@/components/ui/card";

interface PolicyView {
  currency: string;
  maxUnitPrice: string | null;
  maxLeadTimeDays: number | null;
  confirmedByBusiness: boolean;
  isFallback: boolean;
  updatedAt: string | null;
}

export function PolicyForm({ policy, readOnly }: { policy: PolicyView; readOnly: boolean }) {
  const router = useRouter();
  const [currency, setCurrency] = useState(policy.currency);
  const [maxUnitPrice, setMaxUnitPrice] = useState(policy.maxUnitPrice ?? "");
  const [maxLeadTimeDays, setMaxLeadTimeDays] = useState(
    policy.maxLeadTimeDays === null ? "" : String(policy.maxLeadTimeDays),
  );
  const [confirmed, setConfirmed] = useState(policy.confirmedByBusiness);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/procurement/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currency: currency.toUpperCase(),
          maxUnitPrice: maxUnitPrice.trim() === "" ? null : maxUnitPrice.trim(),
          maxLeadTimeDays: maxLeadTimeDays.trim() === "" ? null : Number(maxLeadTimeDays),
          confirmedByBusiness: confirmed,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "保存失败");
        return;
      }
      setInfo("采购策略已保存;既有报价行的原始异常标记不受影响(固化后不改写)");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="异常判定阈值"
      sub={policy.updatedAt ? `更新于 ${policy.updatedAt.slice(0, 16).replace("T", " ")}` : "尚未配置"}
    >
      <form onSubmit={submit}>
        <div className="grid-3">
          <label className="fld">
            <span>比价币种</span>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={readOnly} maxLength={3} />
          </label>
          <label className="fld">
            <span>价格线(留空=不校验)</span>
            <input value={maxUnitPrice} onChange={(e) => setMaxUnitPrice(e.target.value)} disabled={readOnly} />
          </label>
          <label className="fld">
            <span>交期线 / 天(留空=不校验)</span>
            <input
              value={maxLeadTimeDays}
              onChange={(e) => setMaxLeadTimeDays(e.target.value)}
              disabled={readOnly}
            />
          </label>
        </div>
        <label className="fld" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={readOnly}
            style={{ width: "auto" }}
          />
          <span style={{ marginBottom: 0 }}>口径已业务确认(勾选后不再显示「非正式风控」提示)</span>
        </label>
        {error ? <div className="banner warn" role="alert">{error}</div> : null}
        {info ? <div className="banner info" role="status">{info}</div> : null}
        {!readOnly ? (
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "保存中…" : "保存策略"}
          </button>
        ) : (
          <p className="small muted">当前角色只读。</p>
        )}
      </form>
    </Card>
  );
}

export function SupplierOfferForm({ suppliers }: { suppliers: { id: string; label: string }[] }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [mpn, setMpn] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [moq, setMoq] = useState("");
  const [spq, setSpq] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [breaks, setBreaks] = useState("1:0.12, 1000:0.10, 5000:0.085");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const priceBreaks = breaks
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [q, p] = s.split(":").map((x) => x.trim());
        return { minQty: Number(q), unitPrice: p };
      })
      .filter((b) => Number.isFinite(b.minQty) && !!b.unitPrice);

    if (priceBreaks.length === 0) {
      setError("请至少填写一档价格,格式:数量:单价");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/procurement/supplier-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          mpn,
          manufacturer: manufacturer || null,
          currency: currency.toUpperCase(),
          moq: moq ? Number(moq) : null,
          spq: spq ? Number(spq) : null,
          leadTimeDays: leadTimeDays ? Number(leadTimeDays) : null,
          priceBreaks,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "保存失败");
        return;
      }
      setMpn("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="新增供应商预设" sub="MOQ / SPQ / Lead Time / 多阶价格">
      <form onSubmit={submit}>
        <div className="grid-3">
          <label className="fld">
            <span>供应商</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="fld">
            <span>MPN</span>
            <input value={mpn} onChange={(e) => setMpn(e.target.value)} required />
          </label>
          <label className="fld">
            <span>制造商(可空)</span>
            <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          </label>
          <label className="fld">
            <span>币种</span>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} />
          </label>
          <label className="fld">
            <span>MOQ</span>
            <input value={moq} onChange={(e) => setMoq(e.target.value)} />
          </label>
          <label className="fld">
            <span>SPQ</span>
            <input value={spq} onChange={(e) => setSpq(e.target.value)} />
          </label>
          <label className="fld">
            <span>Lead Time(天)</span>
            <input value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
          </label>
        </div>
        <label className="fld">
          <span>价格阶梯(格式 数量:单价,逗号分隔)</span>
          <input value={breaks} onChange={(e) => setBreaks(e.target.value)} />
        </label>
        {error ? <div className="banner warn" role="alert">{error}</div> : null}
        <button className="btn primary" type="submit" disabled={busy || !supplierId}>
          {busy ? "保存中…" : "保存预设"}
        </button>
      </form>
    </Card>
  );
}
