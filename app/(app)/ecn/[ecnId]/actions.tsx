"use client";

/**
 * F2:ECN 操作面板。
 * 按钮只呈现当前状态 + 当前角色允许的动作;无权限时如实注明。
 * Apply to BOM 走确认卡片(二次确认),结果(命中/未命中)如实显示。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import type { EcnStageValue, EcnStatusValue } from "@/lib/domain/ecn";
import { ECN_STAGE_LABEL } from "@/lib/domain/ecn";

interface Props {
  ecnId: string;
  status: EcnStatusValue;
  stage: EcnStageValue | null;
  canDecide: boolean;
  canManage: boolean;
  isFrozen: boolean;
  lineCount: number;
  canEditLines: boolean;
  boms: { id: string; name: string; purpose: string }[];
}

export function EcnActions({ ecnId, status, stage, canDecide, canManage, isFrozen, lineCount, canEditLines, boms }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [csvText, setCsvText] = useState("");
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBomId, setApplyBomId] = useState("");
  const [applyResult, setApplyResult] = useState<{
    newVersionNo: number;
    replaced: { lineNo: number; from: string; to: string }[];
    unmatched: { changeLineNo: number; oldRef: string }[];
  } | null>(null);

  async function act(action: string, extraComment?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ecn/${ecnId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: (extraComment ?? comment).trim() || null }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "操作失败");
        return;
      }
      setComment("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function importCsv() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ecn/${ecnId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "导入失败");
        return;
      }
      setCsvText("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ecn/${ecnId}/apply-to-bom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bomId: applyBomId, confirm: true }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "执行失败");
        return;
      }
      setApplyResult(body);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="操作" sub={stage ? `当前阶段:${ECN_STAGE_LABEL[stage]}` : undefined}>
      {error ? (
        <div className="banner warn" role="alert" data-testid="ecn-action-error">
          {error}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {status === "DRAFT" ? (
          <button className="btn primary" disabled={busy || lineCount === 0} onClick={() => void act("submit")} data-testid="ecn-submit" title={lineCount === 0 ? "至少一条变更行才能提交" : undefined}>
            提交评审
          </button>
        ) : null}
        {status === "REVIEW" && canDecide ? (
          <>
            <button className="btn primary" disabled={busy} onClick={() => void act("approve")} data-testid="ecn-approve">
              通过({stage ? ECN_STAGE_LABEL[stage] : ""})
            </button>
            <button className="btn" disabled={busy || !comment.trim()} onClick={() => void act("reject")} data-testid="ecn-reject" title="退回必须填写原因">
              退回(原因必填)
            </button>
          </>
        ) : null}
        {status === "REVIEW" && !canDecide ? (
          <span className="small muted" data-testid="ecn-no-permission">
            您无权审批此 ECN(当前阶段:{stage ? ECN_STAGE_LABEL[stage] : "—"})
          </span>
        ) : null}
        {status === "CUSTOMER_CONFIRM" ? (
          <button className="btn primary" disabled={busy} onClick={() => void act("customer-confirm")} data-testid="ecn-customer-confirm">
            客户已确认(人工登记)
          </button>
        ) : null}
        {status === "APPROVED" && canManage ? (
          <button className="btn primary" disabled={busy} onClick={() => void act("release")} data-testid="ecn-release">
            发布(冻结快照)
          </button>
        ) : null}
        {status === "RELEASED" ? (
          <>
            <button className="btn" disabled={busy} onClick={() => setApplyOpen(true)} data-testid="ecn-apply-open">
              Apply to BOM…
            </button>
            {canManage ? (
              <button className="btn" disabled={busy} onClick={() => void act("close")} data-testid="ecn-close">
                关闭
              </button>
            ) : null}
          </>
        ) : null}
        {["DRAFT", "REVIEW", "CUSTOMER_CONFIRM", "APPROVED"].includes(status) ? (
          <button
            className="btn"
            style={{ color: "var(--danger)" }}
            disabled={busy || !comment.trim()}
            onClick={() => void act("void")}
            data-testid="ecn-void"
            title="作废必须填写原因"
          >
            作废(原因必填)
          </button>
        ) : null}
        <input
          className="input-xs"
          style={{ minWidth: 260 }}
          placeholder="意见 / 退回或作废原因"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-label="意见或原因"
        />
      </div>

      {applyOpen ? (
        <div className="banner soft" style={{ marginTop: 10 }} data-testid="ecn-apply-card">
          {applyResult ? (
            <div>
              <b>Apply to BOM 完成</b>:生成新版本 V{applyResult.newVersionNo};替换{" "}
              {applyResult.replaced.length} 行
              {applyResult.unmatched.length > 0 ? (
                <>
                  ;<b>{applyResult.unmatched.length} 条变更行未命中任何 BOM 行</b>(如实列出,不静默):
                  <ul className="small" style={{ margin: "4px 0 0 18px" }}>
                    {applyResult.unmatched.slice(0, 10).map((u) => (
                      <li key={u.changeLineNo}>
                        变更行 {u.changeLineNo}:{u.oldRef}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <div style={{ marginTop: 6 }}>
                <button className="btn xs" onClick={() => setApplyOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
          ) : (
            <div>
              <b>二次确认</b>:将基于所选 BOM 的最新版本生成<b>新版本</b>(原版本不动),
              把匹配旧料的行替换为新料并回链本 ECN。替换后的行需重新匹配主数据。
              <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                <select value={applyBomId} onChange={(e) => setApplyBomId(e.target.value)} aria-label="选择 BOM">
                  <option value="">选择 BOM…</option>
                  {boms.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.purpose === "PRODUCTION" ? "(正式)" : "(预)"}
                    </option>
                  ))}
                </select>
                <button className="btn primary" disabled={busy || !applyBomId} onClick={() => void apply()} data-testid="ecn-apply-confirm">
                  确认执行
                </button>
                <button className="btn" onClick={() => setApplyOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {!isFrozen && canEditLines ? (
        <div style={{ marginTop: 10 }}>
          <div className="small muted">
            批量导入变更行(CSV,列:旧内部料号,旧MPN,新内部料号,新MPN,数量影响,原因,工程备注;首行表头)
          </div>
          <textarea
            style={{ width: "100%", minHeight: 80, marginTop: 4 }}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            aria-label="变更行 CSV"
            placeholder={"旧内部料号,旧MPN,新内部料号,新MPN,数量影响,原因,工程备注\n,USB4105-GF-A,,USB4110-GF-A,,EOL 替换,"}
          />
          <button className="btn" style={{ marginTop: 4 }} disabled={busy || !csvText.trim()} onClick={() => void importCsv()} data-testid="ecn-import-lines">
            导入变更行
          </button>
        </div>
      ) : null}
      {isFrozen && status === "DRAFT" ? null : isFrozen ? (
        <p className="small muted" style={{ marginTop: 8 }}>
          评审开始后头信息与变更行冻结;退回草稿后方可修改。
        </p>
      ) : null}
    </Card>
  );
}
