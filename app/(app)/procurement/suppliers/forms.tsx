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
        {/*
          N-9.A(客户 PR2 反馈 采购-6A:「是否应用到 PO 中?」)。
          答案是**已经应用**了 —— 采购订单在价格复核与提交时就用这套阈值判异常
          (lib/server/repositories/purchase-order.ts::loadPolicy)。
          客户会这么问,是因为页面上从没说过。写清楚,省得靠猜。
        */}
        <div className="banner soft" data-testid="policy-scope-note">
          这套阈值**已应用到采购订单**:新建/复核 PO 时按价格线、交期线与涨幅线逐行判异常,
          未处理的异常会挡住提交复核。也用于线下报价导入时<b>固化原始异常集合</b>
          (导入后调阈值不改写既有标记)。
        </div>
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
  /*
   * D-2(客户 PR2 反馈 采购-6C:「阶梯价格以报价数量分行显示,不用分号区别」)。
   *
   * 原来是**一个文本框** `"1:0.12, 1000:0.10, 5000:0.085"`,靠逗号与冒号解析:
   * 少一个冒号、用了中文逗号、或数量里带千分位,整档就被 filter 静默丢掉 ——
   * 人看不出少了哪一档,却已经按错的阶梯价在比价。
   * 改成每档一行的结构化输入,数量与单价各自成格,不再有分隔符可写错。
   */
  const [rows, setRows] = useState<{ minQty: string; unitPrice: string }[]>([
    { minQty: "1", unitPrice: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const filled = rows.filter((r) => r.minQty.trim() !== "" || r.unitPrice.trim() !== "");
    if (filled.length === 0) {
      setError("请至少填写一档价格");
      return;
    }
    /*
     * 填了一半的行**必须报错**,不能像原来那样静默丢掉 ——
     * 少一档价格会直接改变比价结论,而人以为自己填了。
     */
    const bad = filled.findIndex(
      (r) => !Number.isFinite(Number(r.minQty)) || Number(r.minQty) <= 0 || r.unitPrice.trim() === "",
    );
    if (bad >= 0) {
      setError(`第 ${bad + 1} 档填写不完整:数量需为正数,单价不能为空`);
      return;
    }
    const priceBreaks = filled.map((r) => ({
      minQty: Number(r.minQty),
      unitPrice: r.unitPrice.trim(),
    }));
    // 同一数量出现两次时后一档会覆盖前一档,与其让人事后困惑,不如当场拒绝
    const dup = priceBreaks.map((b) => b.minQty).findIndex((q, i, arr) => arr.indexOf(q) !== i);
    if (dup >= 0) {
      setError(`起订数量 ${priceBreaks[dup].minQty} 重复,请合并为一档`);
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
      setRows([{ minQty: "1", unitPrice: "" }]);
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
        <div className="fld">
          <span>价格阶梯(每档一行)</span>
          <table className="tbl" data-testid="price-break-rows">
            <thead>
              <tr>
                <th style={{ width: "40%" }}>起订数量</th>
                <th>单价</th>
                <th style={{ width: 72 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input
                      aria-label={`第 ${i + 1} 档起订数量`}
                      value={r.minQty}
                      onChange={(e) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, minQty: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`第 ${i + 1} 档单价`}
                      value={r.unitPrice}
                      onChange={(e) =>
                        setRows(
                          rows.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    {/* 只剩一档时不给删 —— 删光了表单就没有价格可提交 */}
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      >
                        删除
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="btn sm"
            style={{ marginTop: 6 }}
            onClick={() => setRows([...rows, { minQty: "", unitPrice: "" }])}
          >
            + 增加一档
          </button>
        </div>
        {error ? <div className="banner warn" role="alert">{error}</div> : null}
        <button className="btn primary" type="submit" disabled={busy || !supplierId}>
          {busy ? "保存中…" : "保存预设"}
        </button>
      </form>
    </Card>
  );
}
