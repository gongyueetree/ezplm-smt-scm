"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";

export function TemplateEditor({
  laborTemplates,
  customers,
}: {
  laborTemplates: { id: string; name: string }[];
  customers: { id: string; label: string; tier: string | null }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [tier, setTier] = useState("");
  const [markup, setMarkup] = useState("");
  const [labor, setLabor] = useState(laborTemplates[0]?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [cust, setCust] = useState(customers[0]?.id ?? "");
  const [custTier, setCustTier] = useState("");
  const [tierMsg, setTierMsg] = useState<string | null>(null);

  async function createTemplate() {
    setMsg(null);
    const res = await fetch("/api/quote-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        tier: tier || null,
        defaultMarkupPct: markup.trim() || null,
        laborTemplateId: labor || null,
        confirmedByBusiness: confirmed,
      }),
    });
    const body = await res.json().catch(() => null);
    setMsg(res.ok ? `已创建模板「${body.name}」` : (body?.error ?? "创建失败"));
    if (res.ok) {
      setName("");
      setMarkup("");
      router.refresh();
    }
  }

  async function setTierOf() {
    setTierMsg(null);
    const res = await fetch(`/api/customers/${cust}/tier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: custTier || null }),
    });
    const body = await res.json().catch(() => null);
    setTierMsg(res.ok ? "已保存" : (body?.error ?? "保存失败"));
    if (res.ok) router.refresh();
  }

  return (
    <>
      <Card title="新增报价模板" sub="Markup 用小数,如 0.15 表示 15%;留空表示未维护">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>模板名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="A 类标准" />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>适用等级</span>
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">通用(不限等级)</option>
              <option value="A">A 类</option>
              <option value="B">B 类</option>
              <option value="C">C 类</option>
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>默认 Markup</span>
            <input
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
              placeholder="留空 = 未维护"
              style={{ width: 130 }}
            />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>人工费率模板</span>
            <select value={labor} onChange={(e) => setLabor(e.target.value)}>
              {laborTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span className="small">口径已经业务确认</span>
          </label>
          <button className="btn primary" disabled={!name.trim()} onClick={() => void createTemplate()}>
            创建
          </button>
          {msg ? (
            <span className="small muted" data-testid="tpl-msg">
              {msg}
            </span>
          ) : null}
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          不勾「口径已确认」时,模板照样能用,但会在模板列表与报价页标注
          <b>「口径待确认,非正式定价规则」</b>。
        </p>
      </Card>

      <Card title="设置客户等级" sub="清空 = 未评级(不等于 C 级)">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>客户</span>
            <select
              data-testid="customer-select"
              value={cust}
              onChange={(e) => setCust(e.target.value)}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>等级</span>
            <select
              data-testid="customer-tier-select"
              value={custTier}
              onChange={(e) => setCustTier(e.target.value)}
            >
              <option value="">未评级</option>
              <option value="A">A 类</option>
              <option value="B">B 类</option>
              <option value="C">C 类</option>
            </select>
          </label>
          <button className="btn" disabled={!cust} onClick={() => void setTierOf()}>
            保存等级
          </button>
          {tierMsg ? (
            <span className="small muted" data-testid="tier-msg">
              {tierMsg}
            </span>
          ) : null}
        </div>
      </Card>
    </>
  );
}
