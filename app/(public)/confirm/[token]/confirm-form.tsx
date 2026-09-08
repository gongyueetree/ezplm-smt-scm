"use client";

/**
 * F3:公开确认表单(PO 确认 / OPO 交期)。
 * 提交一次成功后就地显示回执;再次提交由服务端条件更新挡下(409)。
 */
import { useState } from "react";
import type { PublicView } from "@/lib/server/repositories/supplier-action";

type OkView = Extract<PublicView, { access: "ok" }>;

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 8, padding: "6px 8px", width: "100%" };
const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #eee", fontSize: 13 };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f3f3f3", fontSize: 13 };

export function ConfirmForm({ token, view }: { token: string; view: OkView }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"CONFIRM" | "CONFIRM_WITH_CHANGES" | "CANNOT_ACCEPT">("CONFIRM");
  const [poLines, setPoLines] = useState<Record<number, { qty: string; eta: string }>>({});
  const [etaLines, setEtaLines] = useState<Record<string, { eta: string; qty: string; note: string }>>({});
  // R3-4:CALL_MATERIAL / RFQ_QUOTE
  const [canSupply, setCanSupply] = useState<"yes" | "no" | "">("");
  const [callQty, setCallQty] = useState("");
  const [callEta, setCallEta] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [quoteLines, setQuoteLines] = useState<
    Record<string, { unitPrice: string; moq: string; spq: string; leadTimeDays: string; validUntil: string; note: string }>
  >({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload =
        view.kind === "PO_CONFIRM"
          ? {
              kind: "PO_CONFIRM",
              decision,
              respondedByName: name,
              respondedByEmail: email,
              supplierNote: note || null,
              lines: Object.entries(poLines)
                .filter(([, v]) => v.qty || v.eta)
                .map(([lineNo, v]) => ({
                  lineNo: Number(lineNo),
                  confirmedQty: v.qty || null,
                  confirmedEta: v.eta || null,
                })),
            }
          : view.kind === "OPO_ETA"
            ? {
                kind: "OPO_ETA",
                respondedByName: name,
                respondedByEmail: email,
                lines: Object.entries(etaLines)
                  .filter(([, v]) => v.eta || v.qty || v.note)
                  .map(([opoLineId, v]) => ({
                    opoLineId,
                    replyEta: v.eta || null,
                    replyQty: v.qty || null,
                    replyNote: v.note || null,
                  })),
              }
            : view.kind === "CALL_MATERIAL"
              ? {
                  kind: "CALL_MATERIAL",
                  respondedByName: name,
                  respondedByEmail: email,
                  canSupply: canSupply === "yes",
                  replyQty: callQty || null,
                  replyEta: callEta || null,
                  replyNote: note || null,
                }
              : {
                  kind: "RFQ_QUOTE",
                  respondedByName: name,
                  respondedByEmail: email,
                  currency,
                  lines: Object.entries(quoteLines)
                    .filter(([, v]) => v.unitPrice)
                    .map(([mpn, v]) => ({
                      mpn,
                      unitPrice: v.unitPrice,
                      moq: v.moq || null,
                      spq: v.spq || null,
                      leadTimeDays: v.leadTimeDays ? Number(v.leadTimeDays) : null,
                      validUntil: v.validUntil || null,
                      note: v.note || null,
                    })),
                };
      const res = await fetch(`/api/confirm/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? `提交失败(${res.status})`);
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p data-testid="confirm-done" style={{ color: "#00890b", fontWeight: 600 }}>
        已收到贵司的回复,感谢确认。本链接已失效,如需修改请联系采购重新发送。
      </p>
    );
  }

  return (
    <div>
      {view.kind === "PO_CONFIRM" ? (
        <>
          <p style={{ fontSize: 14 }}>
            采购订单 <b>{view.poNo}</b> · 致 <b>{view.supplierName}</b> · 链接有效至{" "}
            {view.expiresAt.slice(0, 10)}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0" }} data-testid="po-lines">
            <thead>
              <tr>
                <th style={th}>行</th>
                <th style={th}>型号</th>
                <th style={th}>数量</th>
                <th style={th}>需求日期</th>
                <th style={th}>确认数量(如有变更)</th>
                <th style={th}>确认交期(如有变更)</th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((l) => (
                <tr key={l.lineNo}>
                  <td style={td}>{l.lineNo}</td>
                  <td style={td}>{l.mpn ?? "—"}</td>
                  <td style={td}>{l.qty}</td>
                  <td style={td}>{l.requestDate ?? "—"}</td>
                  <td style={td}>
                    <input
                      style={box}
                      inputMode="decimal"
                      aria-label={`第 ${l.lineNo} 行确认数量`}
                      value={poLines[l.lineNo]?.qty ?? ""}
                      onChange={(e) =>
                        setPoLines((p) => ({ ...p, [l.lineNo]: { qty: e.target.value, eta: p[l.lineNo]?.eta ?? "" } }))
                      }
                    />
                  </td>
                  <td style={td}>
                    <input
                      style={box}
                      type="date"
                      aria-label={`第 ${l.lineNo} 行确认交期`}
                      value={poLines[l.lineNo]?.eta ?? ""}
                      onChange={(e) =>
                        setPoLines((p) => ({ ...p, [l.lineNo]: { qty: p[l.lineNo]?.qty ?? "", eta: e.target.value } }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 12, margin: "10px 0" }} role="radiogroup" aria-label="确认结论">
            {(
              [
                ["CONFIRM", "确认接受"],
                ["CONFIRM_WITH_CHANGES", "有变更地确认(需在上表填写变更)"],
                ["CANNOT_ACCEPT", "无法接受"],
              ] as const
            ).map(([v, label]) => (
              <label key={v} style={{ fontSize: 14 }}>
                <input type="radio" name="decision" checked={decision === v} onChange={() => setDecision(v)} /> {label}
              </label>
            ))}
          </div>
        </>
      ) : view.kind === "OPO_ETA" ? (
        <>
          <p style={{ fontSize: 14 }}>
            致 <b>{view.supplierName}</b>:请回复以下未交订单行的交期 · 链接有效至 {view.expiresAt.slice(0, 10)}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0" }} data-testid="eta-lines">
            <thead>
              <tr>
                <th style={th}>PO/行</th>
                <th style={th}>型号</th>
                <th style={th}>未交数量</th>
                <th style={th}>原承诺交期</th>
                <th style={th}>回复交期</th>
                <th style={th}>回复数量</th>
                <th style={th}>说明</th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((l) => (
                <tr key={l.opoLineId}>
                  <td style={td}>
                    {l.poNo}#{l.lineNo}
                  </td>
                  <td style={td}>{l.mpn ?? "—"}</td>
                  <td style={td}>{l.qtyOpen}</td>
                  <td style={td}>{l.promiseDate ?? "—"}</td>
                  <td style={td}>
                    <input
                      style={box}
                      type="date"
                      aria-label={`${l.poNo}#${l.lineNo} 回复交期`}
                      value={etaLines[l.opoLineId]?.eta ?? ""}
                      onChange={(e) =>
                        setEtaLines((p) => ({
                          ...p,
                          [l.opoLineId]: { ...(p[l.opoLineId] ?? { eta: "", qty: "", note: "" }), eta: e.target.value },
                        }))
                      }
                    />
                  </td>
                  <td style={td}>
                    <input
                      style={box}
                      inputMode="decimal"
                      aria-label={`${l.poNo}#${l.lineNo} 回复数量`}
                      value={etaLines[l.opoLineId]?.qty ?? ""}
                      onChange={(e) =>
                        setEtaLines((p) => ({
                          ...p,
                          [l.opoLineId]: { ...(p[l.opoLineId] ?? { eta: "", qty: "", note: "" }), qty: e.target.value },
                        }))
                      }
                    />
                  </td>
                  <td style={td}>
                    <input
                      style={box}
                      aria-label={`${l.poNo}#${l.lineNo} 说明`}
                      value={etaLines[l.opoLineId]?.note ?? ""}
                      onChange={(e) =>
                        setEtaLines((p) => ({
                          ...p,
                          [l.opoLineId]: { ...(p[l.opoLineId] ?? { eta: "", qty: "", note: "" }), note: e.target.value },
                        }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : view.kind === "CALL_MATERIAL" ? (
        <>
          <p style={{ fontSize: 14 }}>
            致 <b>{view.supplierName}</b>:我司紧急 Call 料,请确认能否供应 · 链接有效至 {view.expiresAt.slice(0, 10)}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0" }} data-testid="call-line">
            <thead>
              <tr>
                <th style={th}>型号</th>
                <th style={th}>制造商</th>
                <th style={th}>需求数量</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={td}>{view.mpn ?? "—"}</td>
                <td style={td}>{view.manufacturer ?? "—"}</td>
                <td style={td}>{view.callQty}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 12, margin: "10px 0" }} role="radiogroup" aria-label="能否供应">
            <label style={{ fontSize: 14 }}>
              <input type="radio" name="cansupply" checked={canSupply === "yes"} onChange={() => setCanSupply("yes")} /> 可以供应
            </label>
            <label style={{ fontSize: 14 }}>
              <input type="radio" name="cansupply" checked={canSupply === "no"} onChange={() => setCanSupply("no")} /> 无法供应
            </label>
          </div>
          {canSupply === "yes" ? (
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr", margin: "10px 0" }}>
              <label style={{ fontSize: 13 }}>
                可供数量 *
                <input style={box} inputMode="decimal" value={callQty} onChange={(e) => setCallQty(e.target.value)} aria-label="可供数量" />
              </label>
              <label style={{ fontSize: 13 }}>
                最早交期
                <input style={box} type="date" value={callEta} onChange={(e) => setCallEta(e.target.value)} aria-label="最早交期" />
              </label>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p style={{ fontSize: 14 }}>
            致 <b>{view.supplierName}</b>:询价单 <b>{view.rfqCode}</b> 请贵司报价 · 链接有效至 {view.expiresAt.slice(0, 10)}
          </p>
          <label style={{ fontSize: 13, display: "inline-block", marginBottom: 8 }}>
            报价币种
            <select
              style={{ ...box, width: "auto", marginLeft: 8 }}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              aria-label="报价币种"
            >
              {["CNY", "USD", "EUR", "JPY", "HKD"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0", minWidth: 760 }} data-testid="quote-lines">
              <thead>
                <tr>
                  <th style={th}>型号</th>
                  <th style={th}>制造商</th>
                  <th style={th}>需求参考量</th>
                  <th style={th}>单价 *</th>
                  <th style={th}>MOQ</th>
                  <th style={th}>SPQ</th>
                  <th style={th}>货期(天)</th>
                  <th style={th}>报价有效期</th>
                  <th style={th}>备注</th>
                </tr>
              </thead>
              <tbody>
                {view.mpns.map((m) => {
                  const v = quoteLines[m.mpn] ?? { unitPrice: "", moq: "", spq: "", leadTimeDays: "", validUntil: "", note: "" };
                  const set = (patch: Partial<typeof v>) => setQuoteLines((p) => ({ ...p, [m.mpn]: { ...v, ...patch } }));
                  return (
                    <tr key={m.mpn}>
                      <td style={td}>{m.mpn}</td>
                      <td style={td}>{m.manufacturer ?? "—"}</td>
                      <td style={td}>{m.demandQty}</td>
                      <td style={td}>
                        <input style={{ ...box, minWidth: 80 }} inputMode="decimal" aria-label={`${m.mpn} 单价`} value={v.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} />
                      </td>
                      <td style={td}>
                        <input style={{ ...box, minWidth: 60 }} inputMode="decimal" aria-label={`${m.mpn} MOQ`} value={v.moq} onChange={(e) => set({ moq: e.target.value })} />
                      </td>
                      <td style={td}>
                        <input style={{ ...box, minWidth: 60 }} inputMode="decimal" aria-label={`${m.mpn} SPQ`} value={v.spq} onChange={(e) => set({ spq: e.target.value })} />
                      </td>
                      <td style={td}>
                        <input style={{ ...box, minWidth: 60 }} inputMode="numeric" aria-label={`${m.mpn} 货期`} value={v.leadTimeDays} onChange={(e) => set({ leadTimeDays: e.target.value })} />
                      </td>
                      <td style={td}>
                        <input style={{ ...box, minWidth: 120 }} type="date" aria-label={`${m.mpn} 报价有效期`} value={v.validUntil} onChange={(e) => set({ validUntil: e.target.value })} />
                      </td>
                      <td style={td}>
                        <input style={{ ...box, minWidth: 100 }} aria-label={`${m.mpn} 备注`} value={v.note} onChange={(e) => set({ note: e.target.value })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12, color: "#888" }}>
            未填单价的行视为不报价;单价为 MOQ 起步价,多阶梯价请联系采购走 Excel 报价单。
          </p>
        </>
      )}

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr", margin: "10px 0" }}>
        <label style={{ fontSize: 13 }}>
          您的姓名 *
          <input style={box} value={name} onChange={(e) => setName(e.target.value)} aria-label="您的姓名" />
        </label>
        <label style={{ fontSize: 13 }}>
          您的邮箱 *
          <input style={box} type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="您的邮箱" />
        </label>
      </div>
      {view.kind === "PO_CONFIRM" || view.kind === "CALL_MATERIAL" ? (
        <label style={{ fontSize: 13, display: "block", marginBottom: 10 }}>
          备注(可选)
          <input style={box} value={note} onChange={(e) => setNote(e.target.value)} aria-label="备注" />
        </label>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: "#c0392b", fontSize: 14 }} data-testid="confirm-error">
          {error}
        </p>
      ) : null}

      <button
        onClick={() => void submit()}
        disabled={busy || !name.trim() || !email.trim() || (view.kind === "CALL_MATERIAL" && canSupply === "")}
        data-testid="confirm-submit"
        style={{
          background: "#00890b",
          color: "#fff",
          border: 0,
          borderRadius: 8,
          padding: "10px 20px",
          fontSize: 15,
          cursor: "pointer",
          opacity: busy || !name.trim() || !email.trim() ? 0.5 : 1,
        }}
      >
        {busy ? "提交中…" : "提交确认"}
      </button>
    </div>
  );
}
