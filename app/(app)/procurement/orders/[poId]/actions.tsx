"use client";

/**
 * PO 流转操作区。
 *
 * 按钮只呈现**当前状态允许**的流转 —— 与领域层状态机一致;
 * 退回/作废强制填原因(状态机也会再挡一次,两道都要有:
 * 前端少一道体验差,后端少一道就形同没有)。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PO_STATUS_LABELS, type PoStatusValue } from "@/lib/domain/po-status";

/** F4:API 回写通道的展示状态(与 Excel 模板并列,互不取代) */
interface ErpApiInfo {
  configured: boolean;
  targetLabel: string | null;
  notConfiguredReason: string | null;
  state: string | null;
  documentNo: string | null;
  errorMessage: string | null;
}

interface Props {
  poId: string;
  status: PoStatusValue;
  frozen: boolean;
  unresolved: number;
  liveErrors: number;
  erpExported: boolean;
  erpApi: ErpApiInfo;
}

export function PoActions({ poId, status, unresolved, liveErrors, erpExported, erpApi }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [unresolvedLines, setUnresolvedLines] = useState<number[] | null>(null);
  const [writebackMsg, setWritebackMsg] = useState<string | null>(null);

  async function writebackToErp() {
    setBusy(true);
    setWritebackMsg(null);
    try {
      const res = await fetch(`/api/procurement/orders/${poId}/erp-writeback`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; state: string; documentNo?: string | null; idempotentReplay?: boolean; reason?: string }
        | null;
      if (body?.ok) {
        setWritebackMsg(
          `已同步(${body.state})${body.documentNo ? ` · ERP 单号 ${body.documentNo}` : ""}${
            body.idempotentReplay ? " · 幂等重放:返回首次创建的单据" : ""
          }`,
        );
      } else {
        setWritebackMsg(body?.reason ?? `回写失败(HTTP ${res.status})`);
      }
      router.refresh();
    } catch {
      setWritebackMsg("请求失败,请重试");
    } finally {
      setBusy(false);
    }
  }

  async function go(to: PoStatusValue, opts: { needReason?: boolean; materializeOpo?: boolean } = {}) {
    if (opts.needReason && !reason.trim()) {
      setError("该操作必须填写原因");
      return;
    }
    setBusy(true);
    setError(null);
    setUnresolvedLines(null);
    try {
      const res = await fetch(`/api/procurement/orders/${poId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          reason: opts.needReason ? reason.trim() : null,
          materializeOpo: opts.materializeOpo ?? false,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `操作失败(HTTP ${res.status})`);
        if (Array.isArray(body?.unresolvedLines)) setUnresolvedLines(body.unresolvedLines);
        return;
      }
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const buttons: { label: string; run: () => void; primary?: boolean; danger?: boolean }[] = [];

  if (status === "DRAFT") {
    buttons.push({ label: "提交价格复核", run: () => void go("PENDING_PRICE_REVIEW"), primary: true });
    buttons.push({ label: "作废", run: () => void go("CANCELLED", { needReason: true }), danger: true });
  }
  if (status === "PENDING_PRICE_REVIEW") {
    buttons.push({ label: "复核通过 → 送终审", run: () => void go("PENDING_APPROVAL"), primary: true });
    buttons.push({ label: "复核退回", run: () => void go("REJECTED", { needReason: true }), danger: true });
  }
  if (status === "PENDING_APPROVAL") {
    buttons.push({
      label: "终审通过并生成在途行",
      run: () => void go("APPROVED", { materializeOpo: true }),
      primary: true,
    });
    buttons.push({ label: "终审退回", run: () => void go("REJECTED", { needReason: true }), danger: true });
  }
  if (status === "REJECTED") {
    buttons.push({ label: "退回草稿继续修改", run: () => void go("DRAFT"), primary: true });
    buttons.push({ label: "作废", run: () => void go("CANCELLED", { needReason: true }), danger: true });
  }
  if (status === "APPROVED") {
    buttons.push({ label: "标记已导出 ERP 模板", run: () => void go("EXPORTED") });
    buttons.push({ label: "作废", run: () => void go("CANCELLED", { needReason: true }), danger: true });
  }

  const needReason =
    status === "DRAFT" ||
    status === "PENDING_PRICE_REVIEW" ||
    status === "PENDING_APPROVAL" ||
    status === "REJECTED" ||
    status === "APPROVED";

  return (
    <Card title="流转操作" sub={`当前:${PO_STATUS_LABELS[status]}`}>
      {status === "DRAFT" && liveErrors > 0 ? (
        <div className="banner warn">
          有 <b>{liveErrors}</b> 行存在价格/交期异常。
          {unresolved > 0 ? (
            <>
              {" "}
              其中 <b>{unresolved}</b> 行尚未给出处理结论 —— 逐项处理后方可提交复核。
            </>
          ) : null}
        </div>
      ) : null}

      {buttons.length === 0 ? (
        <p className="small muted">
          本单已到终态({PO_STATUS_LABELS[status]}),无可用流转。
          {erpExported ? " ERP 模板已导出。" : ""}
        </p>
      ) : (
        <>
          {needReason ? (
            <label className="fld">
              <span>原因(退回 / 作废必填)</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如:单价较上次成交上涨 20%,要求重新询价"
              />
            </label>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {buttons.map((b) => (
              <button
                key={b.label}
                className={`btn${b.primary ? " primary" : ""}`}
                style={b.danger ? { color: "var(--danger)" } : undefined}
                disabled={busy}
                onClick={b.run}
              >
                {b.label}
              </button>
            ))}
            {status === "APPROVED" || status === "EXPORTED" ? (
              <a className="btn" href={`/api/procurement/orders/${poId}/erp-export`}>
                下载 ERP 批量下单模板
              </a>
            ) : null}
          </div>

          {/* F4:ERP 输出双通道并列展示 —— API 未配置时 Excel 兜底链不受影响 */}
          {status === "APPROVED" || status === "EXPORTED" ? (
            <div className="banner soft" style={{ marginTop: 10 }} data-testid="erp-dual-channel">
              <b>ERP 输出通道</b>:Excel 模板<b>可用</b>(上方按钮);API 直写
              {erpApi.configured ? (
                <>
                  目标 <b>{erpApi.targetLabel}</b>。
                  {erpApi.state === "SYNCED" ? (
                    <>
                      {" "}
                      本单已同步{erpApi.documentNo ? `,ERP 单号 ${erpApi.documentNo}` : ""}。
                    </>
                  ) : (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="btn"
                        style={{ marginLeft: 6 }}
                        disabled={busy}
                        onClick={() => void writebackToErp()}
                        data-testid="erp-writeback-btn"
                      >
                        {busy ? "回写中…" : "回写 ERP(API)"}
                      </button>
                      {erpApi.state ? ` 当前状态:${erpApi.state}` : ""}
                      {erpApi.errorMessage ? (
                        <div className="small muted">{erpApi.errorMessage}</div>
                      ) : null}
                    </>
                  )}
                </>
              ) : (
                <>
                  <b>待联调</b>
                  {erpApi.notConfiguredReason ? `(${erpApi.notConfiguredReason})` : ""}。
                </>
              )}
              {writebackMsg ? (
                <div className="small" data-testid="erp-writeback-msg">
                  {writebackMsg}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <div className="banner warn" style={{ marginTop: 10 }} data-testid="po-action-error">
          {error}
          {unresolvedLines?.length ? (
            <div className="small">未处理异常行:第 {unresolvedLines.join("、")} 行</div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
