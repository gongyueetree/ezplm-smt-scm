"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";

export function CollabActions({ orders }: { orders: { id: string; poNo: string }[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const [ackPo, setAckPo] = useState(orders[0]?.poNo ?? "");
  const [ackDecision, setAckDecision] = useState("ACCEPTED");
  const [ackMsg, setAckMsg] = useState<string | null>(null);

  async function dispatch() {
    setMsg(null);
    const res = await fetch("/api/supplier-collab/po-dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseOrderIds: selected }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setMsg(body?.error ?? "生成失败");
      return;
    }
    const failed = (body.drafts ?? []).filter((d: { ok: boolean }) => !d.ok);
    setMsg(
      `已生成 ${(body.drafts ?? []).length - failed.length} 封草稿(系统未发送)` +
        (failed.length ? `;${failed.length} 张未生成:${failed.map((f: { poNo: string; reason: string }) => `${f.poNo}(${f.reason})`).join("、")}` : ""),
    );
    router.refresh();
  }

  async function invite() {
    setInviteMsg(null);
    const res = await fetch("/api/supplier-collab/onboard-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: company.trim() || null,
        toEmail: email.trim() || null,
        validDays: 30,
      }),
    });
    const body = await res.json().catch(() => null);
    setInviteMsg(res.ok ? `已生成邀请链接与邮件草稿(系统未发送)` : (body?.error ?? "生成失败"));
    if (res.ok) {
      setCompany("");
      setEmail("");
      router.refresh();
    }
  }

  async function recordAck() {
    setAckMsg(null);
    const res = await fetch("/api/supplier-collab/po-ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poNo: ackPo, decision: ackDecision, source: "EMAIL_MANUAL" }),
    });
    const body = await res.json().catch(() => null);
    setAckMsg(res.ok ? "已登记回执" : (body?.error ?? "登记失败"));
    if (res.ok) router.refresh();
  }

  return (
    <>
      <Card title="批量生成订单邮件草稿" sub="仅限已审批订单;系统不发送邮件">
        <div
          style={{
            maxHeight: 160,
            overflow: "auto",
            border: "1px solid var(--gray-200)",
            borderRadius: 8,
            padding: 8,
            marginBottom: 8,
          }}
        >
          {orders.length === 0 ? (
            <p className="small muted">暂无已审批订单</p>
          ) : (
            orders.map((o) => (
              <label key={o.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: 2 }}>
                <input
                  type="checkbox"
                  checked={selected.includes(o.id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, o.id] : prev.filter((x) => x !== o.id),
                    )
                  }
                />
                <span className="small mono">{o.poNo}</span>
              </label>
            ))
          )}
        </div>
        <button className="btn primary" disabled={selected.length === 0} onClick={() => void dispatch()}>
          生成 {selected.length} 封草稿
        </button>
        {msg ? (
          <div className="banner soft" style={{ marginTop: 8 }} data-testid="dispatch-msg">
            {msg}
          </div>
        ) : null}
      </Card>

      <Card title="供应商建档邀请" sub="生成邀请链接与邮件草稿;资料复核通过前不进主数据">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>公司名称</span>
            <input value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>对方邮箱</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="可留空" />
          </label>
          <button className="btn" onClick={() => void invite()}>
            生成邀请
          </button>
          {inviteMsg ? (
            <span className="small muted" data-testid="invite-msg">
              {inviteMsg}
            </span>
          ) : null}
        </div>
      </Card>

      <Card title="登记接单回执" sub="供应商回复目前只能人工登记,来源如实记录">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>PO 号</span>
            <select data-testid="ack-po" value={ackPo} onChange={(e) => setAckPo(e.target.value)}>
              {orders.map((o) => (
                <option key={o.id} value={o.poNo}>
                  {o.poNo}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>结论</span>
            <select
              data-testid="ack-decision"
              value={ackDecision}
              onChange={(e) => setAckDecision(e.target.value)}
            >
              <option value="ACCEPTED">接受</option>
              <option value="PARTIAL">部分接受</option>
              <option value="REJECTED">拒绝</option>
            </select>
          </label>
          <button className="btn" disabled={!ackPo} onClick={() => void recordAck()}>
            登记
          </button>
          {ackMsg ? (
            <span className="small muted" data-testid="ack-msg">
              {ackMsg}
            </span>
          ) : null}
        </div>
      </Card>
    </>
  );
}
