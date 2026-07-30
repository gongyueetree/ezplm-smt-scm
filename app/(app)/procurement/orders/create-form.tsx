"use client";

/**
 * 建单 + 批量录入(客户 xlsx「采购订单批量录入」)。
 *
 * 采购的实际习惯是从 Excel 整块复制,所以这里就吃粘贴的表格文本;
 * 解析走 `lib/domain/po-bulk-input.ts`(有单测),**不在这里手搓字符串切分**。
 * 解析结果先给预览与逐行报错,人确认后才落库。
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { parsePoBulkText } from "@/lib/domain/po-bulk-input";

const SAMPLE = `MPN\t数量\t单价\tMOQ\tSPQ\t交期\t需求日期
STM32F103C8T6\t1000\t7.10\t100\t100\t30\t2026-09-01
GRM188R71H104KA93D\t5000\t0.042\t4000\t4000\t21\t2026-09-10`;

export function CreatePoForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [poNo, setPoNo] = useState("");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [currency, setCurrency] = useState("CNY");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => (text.trim() ? parsePoBulkText(text) : null), [text]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/procurement/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poNo: poNo.trim(),
          supplierId,
          currency,
          lines: parsed?.lines ?? [],
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `创建失败(HTTP ${res.status})`);
        return;
      }
      router.push(`/procurement/orders/${body.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Card title="新建采购订单" sub="支持从 Excel 整块粘贴批量录入">
        <button className="btn primary" onClick={() => setOpen(true)}>
          新建采购订单
        </button>
      </Card>
    );
  }

  const canSubmit =
    poNo.trim().length > 0 &&
    supplierId.length > 0 &&
    (parsed?.lines.length ?? 0) > 0 &&
    (parsed?.errors.length ?? 0) === 0;

  return (
    <Card title="新建采购订单" sub="批量录入:粘贴带表头的表格,列顺序随意">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>PO 号</span>
          <input value={poNo} onChange={(e) => setPoNo(e.target.value)} placeholder="PO-2026-010" />
        </label>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>供应商</span>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>币种</span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            style={{ width: 90 }}
          />
        </label>
      </div>

      <label className="fld" style={{ marginTop: 12 }}>
        <span>粘贴订单行(Tab / 逗号 / 分号分隔均可;必需列:MPN、数量)</span>
        <textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={SAMPLE}
          style={{ fontFamily: "var(--mono, monospace)", fontSize: 12 }}
        />
      </label>
      <button className="btn xs" onClick={() => setText(SAMPLE)}>
        填入示例
      </button>

      {parsed ? (
        <div style={{ marginTop: 12 }}>
          {parsed.errors.length > 0 ? (
            <div className="banner warn">
              <b>解析报错 {parsed.errors.length} 条</b>(逐行列出,不静默丢弃):
              <ul style={{ margin: "6px 0 0 18px" }}>
                {parsed.errors.slice(0, 10).map((e, i) => (
                  <li key={i} className="small">
                    第 {e.row} 行:{e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {parsed.notices.length > 0 ? (
            <div className="banner soft">
              {parsed.notices.map((n, i) => (
                <div key={i} className="small">
                  {n}
                </div>
              ))}
            </div>
          ) : null}

          {parsed.lines.length > 0 ? (
            <div className="tbl-scroll" style={{ marginTop: 8 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>行</th>
                    <th>MPN</th>
                    <th className="num">数量</th>
                    <th className="num">单价</th>
                    <th className="num">MOQ</th>
                    <th className="num">SPQ</th>
                    <th className="num">交期</th>
                    <th>需求日期</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.lines.slice(0, 20).map((l) => (
                    <tr key={l.lineNo}>
                      <td>{l.lineNo}</td>
                      <td className="mono small">{l.mpn}</td>
                      <td className="num">{l.qty}</td>
                      <td className="num">{l.unitPrice ?? "—"}</td>
                      <td className="num">{l.moq ?? "—"}</td>
                      <td className="num">{l.spq ?? "—"}</td>
                      <td className="num">{l.leadTimeDays ?? "—"}</td>
                      <td className="small">{l.requestDate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted" style={{ marginTop: 6 }}>
                共 {parsed.lines.length} 行(预览前 20)。「—」表示该列未提供 ——
                <b>留空而不是填 0</b>,单价填 0 会被复核误读成免费。
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="banner warn" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn primary" disabled={!canSubmit || busy} onClick={() => void submit()}>
          {busy ? "创建中…" : "创建订单"}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </Card>
  );
}
