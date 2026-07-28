"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface Preview {
  gtb: {
    grossDemand: string;
    netDemand: string;
    purchaseQty: number;
    scrapRateUsed: string;
    scrapRateConfirmed: boolean;
    steps: string[];
  };
  slowMovingQty: number | null;
  stockQty: number;
  inTransitQty: number;
}

export function GtbCalculator() {
  const router = useRouter();
  const [mpn, setMpn] = useState("STM32F103C8T6");
  const [demandQty, setDemandQty] = useState("1000");
  const [scrapRate, setScrapRate] = useState("0");
  const [moq, setMoq] = useState("");
  const [spq, setSpq] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function payload(previewOnly: boolean) {
    return {
      mpn,
      demandQty: Number(demandQty),
      scrapRate: scrapRate || "0",
      moq: moq ? Number(moq) : null,
      spq: spq ? Number(spq) : null,
      previewOnly,
    };
  }

  async function calc() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/procurement/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(true)),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "试算失败");
        return;
      }
      setPreview(body.preview as Preview);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/procurement/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(false)),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "提交失败");
        return;
      }
      setPreview(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="GTB 核算" sub="先试算,确认无误再提交">
      <div className="grid-3">
        <label className="fld">
          <span>MPN</span>
          <input value={mpn} onChange={(e) => setMpn(e.target.value)} />
        </label>
        <label className="fld">
          <span>需求数量</span>
          <input value={demandQty} onChange={(e) => setDemandQty(e.target.value)} />
        </label>
        <label className="fld">
          <span>损耗率(0.02 = 2%,待甲方确认)</span>
          <input value={scrapRate} onChange={(e) => setScrapRate(e.target.value)} />
        </label>
        <label className="fld">
          <span>MOQ(可空)</span>
          <input value={moq} onChange={(e) => setMoq(e.target.value)} />
        </label>
        <label className="fld">
          <span>SPQ(可空)</span>
          <input value={spq} onChange={(e) => setSpq(e.target.value)} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={calc} disabled={busy}>
          试算 GTB
        </button>
        <button className="btn primary" onClick={submit} disabled={busy || !preview}>
          提交采购申请
        </button>
      </div>

      {error ? (
        <div className="banner warn" style={{ marginTop: 12 }} role="alert">
          {error}
        </div>
      ) : null}

      {preview ? (
        <div style={{ marginTop: 14 }}>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">毛需求</div>
              <div className="kpi-value">{preview.gtb.grossDemand}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">库存(缓存)</div>
              <div className="kpi-value">{preview.stockQty}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">在途</div>
              <div className="kpi-value">{preview.inTransitQty}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">建议采购量</div>
              <div className="kpi-value">{preview.gtb.purchaseQty}</div>
            </div>
            {preview.slowMovingQty !== null && preview.slowMovingQty > 0 ? (
              <div className="kpi warn">
                <div className="kpi-label">同 MPN 呆滞</div>
                <div className="kpi-value">{preview.slowMovingQty}</div>
                <div className="kpi-foot">优先消耗呆滞库存</div>
              </div>
            ) : null}
          </div>
          <div className="divider" />
          <div className="small">
            <b>计算过程</b>{" "}
            {!preview.gtb.scrapRateConfirmed ? <Badge tone="amber">损耗率待甲方确认</Badge> : null}
            <ul style={{ lineHeight: 1.9, paddingLeft: 18, marginTop: 6 }}>
              {preview.gtb.steps.map((s, i) => (
                <li key={i} className="muted">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
