"use client";

/**
 * 匹配面板:粘贴对方对账单 → 选我方基准来源 → 执行匹配。
 *
 * 诚实 UI 的落点:
 * - 基准来源必须**由人明确选**,不给"系统自动搞定"的错觉;
 * - 导出按钮的措辞是「导出对账单附件」,不是「发送对账单」——
 *   邮件通道未接入,不能出现"已发送"。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";

const SAMPLE = `发票号,行号,MPN,数量,单价,金额,到期日
INV-2026-001,1,STM32F103C8T6,1000,7.10,7100.00,2026-08-30`;

export function MatchPanel({
  statementId,
  kind,
  currency,
  hasLines,
}: {
  statementId: string;
  kind: "AR" | "AP";
  currency: string;
  hasLines: boolean;
}) {
  const router = useRouter();
  const [theirsText, setTheirsText] = useState("");
  const [oursText, setOursText] = useState("");
  const [source, setSource] = useState<"DERIVED" | "UPLOADED">("DERIVED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<{ row: number; message: string }[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setRowErrors([]);
    setNotices([]);
    try {
      const res = await fetch(`/api/reconciliation/${statementId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theirsText,
          baselineSource: source,
          oursText: source === "UPLOADED" ? oursText : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `匹配失败(HTTP ${res.status})`);
        setRowErrors(Array.isArray(body?.errors) ? body.errors : []);
        setNotices(Array.isArray(body?.notices) ? body.notices : []);
        return;
      }
      setSummary(body.summary ?? null);
      setNotices(Array.isArray(body?.notices) ? body.notices : []);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={hasLines ? "重新匹配" : "执行对账匹配"}
      sub={`对账单币种 ${currency};重跑会整份覆盖上一次结果`}
    >
      <label className="fld">
        <span>对方对账单(粘贴表格;需含「单据号或 MPN」+「金额,或数量与单价」)</span>
        <textarea
          rows={6}
          value={theirsText}
          onChange={(e) => setTheirsText(e.target.value)}
          placeholder={SAMPLE}
          style={{ fontFamily: "var(--mono, monospace)", fontSize: 12 }}
        />
      </label>
      <button className="btn xs" onClick={() => setTheirsText(SAMPLE)}>
        填入示例
      </button>

      <div style={{ marginTop: 12 }}>
        <b className="small">我方基准来源</b>
        <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <button
            className={`btn sm${source === "DERIVED" ? " primary" : ""}`}
            onClick={() => setSource("DERIVED")}
            aria-pressed={source === "DERIVED"}
          >
            本系统已批准单据派生
          </button>
          <button
            className={`btn sm${source === "UPLOADED" ? " primary" : ""}`}
            onClick={() => setSource("UPLOADED")}
            aria-pressed={source === "UPLOADED"}
          >
            上传 ERP 导出明细
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          {source === "DERIVED" ? (
            <>
              取{kind === "AP" ? "已批准/已导出的采购订单行" : "已批准报价版本的行"}作为基准。
              <b>本系统没有出货/入库记录</b>,所以这不是与 ERP 流水核对 ——
              要那样做请改用「上传 ERP 导出明细」。
            </>
          ) : (
            <>
              贴入从 ERP 导出的出货/入库明细作为基准。格式与对方对账单相同。
            </>
          )}
        </p>
      </div>

      {source === "UPLOADED" ? (
        <label className="fld">
          <span>我方明细(ERP 导出)</span>
          <textarea
            rows={6}
            value={oursText}
            onChange={(e) => setOursText(e.target.value)}
            style={{ fontFamily: "var(--mono, monospace)", fontSize: 12 }}
          />
        </label>
      ) : null}

      {error ? (
        <div className="banner warn" style={{ marginTop: 10 }} data-testid="recon-error">
          {error}
          {rowErrors.length > 0 ? (
            <ul style={{ margin: "6px 0 0 18px" }}>
              {rowErrors.slice(0, 10).map((e, i) => (
                <li key={i} className="small">
                  第 {e.row} 行:{e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {notices.length > 0 ? (
        <div className="banner soft" style={{ marginTop: 10 }}>
          {notices.map((n, i) => (
            <div key={i} className="small">
              {n}
            </div>
          ))}
        </div>
      ) : null}

      {summary ? (
        <div className="banner soft" style={{ marginTop: 10 }} data-testid="recon-summary">
          <span className="small">
            匹配完成:一致 {String(summary.matched)} · 差异 {String(summary.differing)} · 仅对方有{" "}
            {String(summary.onlyTheirs)} · 仅我方有 {String(summary.onlyOurs)} · 差额合计{" "}
            {String(summary.currency)} {String(summary.diffTotal)}
            {summary.mixedCurrency ? " · ⚠ 含异币种,已排除出合计且不做换算" : ""}
          </span>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn primary" disabled={busy || !theirsText.trim()} onClick={() => void run()}>
          {busy ? "匹配中…" : hasLines ? "重新匹配" : "执行匹配"}
        </button>
        {hasLines ? (
          <a className="btn" href={`/api/reconciliation/${statementId}/export`}>
            导出对账单附件(含差异与账龄)
          </a>
        ) : null}
      </div>
      {hasLines ? (
        <p className="small muted" style={{ marginTop: 6 }}>
          导出的是<b>可供人工发送的附件</b>。客户问过「能否直接发到指定邮箱」——
          邮件通道<b>未接入</b>,系统不会发送任何邮件。
        </p>
      ) : null}
    </Card>
  );
}
