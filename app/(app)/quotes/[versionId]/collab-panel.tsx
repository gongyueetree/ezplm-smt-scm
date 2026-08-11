"use client";

/**
 * 报价协作面板(PR-D):分项派工 / NRE 填报 / 订单结果标记。
 *
 * 三块放在一起是因为它们回答的是同一个问题:「这张报价现在卡在谁那里、
 * 最后成没成」。分散在三个页面只会让人来回找。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TASK_KIND_LABEL, TASK_STATUS_LABEL, type QuoteTaskKind, type QuoteTaskStatus } from "@/lib/domain/quote-tasks";
import { OUTCOME_LABEL, type QuoteOutcomeValue } from "@/lib/domain/quote-outcome";

export interface TaskView {
  id: string;
  kind: QuoteTaskKind;
  title: string;
  assignedRole: string;
  required: boolean;
  status: QuoteTaskStatus;
  note: string | null;
}

export interface NreDefView {
  id: string;
  code: string;
  name: string;
  defaultAmount: string | null;
}

const ROLES = ["ENGINEERING", "PROCUREMENT", "PM", "MANAGEMENT"] as const;
const ROLE_LABEL: Record<string, string> = {
  ENGINEERING: "工程",
  PROCUREMENT: "采购",
  PM: "PM",
  MANAGEMENT: "管理层",
};

export function CollabPanel({
  versionId,
  frozen,
  canAssign,
  canMarkOutcome,
  tasks,
  nreDefs,
  outcome,
  customerOrderNo,
  outcomeNote,
  hasApprovedVersion,
}: {
  versionId: string;
  frozen: boolean;
  canAssign: boolean;
  canMarkOutcome: boolean;
  tasks: TaskView[];
  nreDefs: NreDefView[];
  outcome: QuoteOutcomeValue;
  customerOrderNo: string | null;
  outcomeNote: string | null;
  hasApprovedVersion: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // 派工表单
  const [kind, setKind] = useState<QuoteTaskKind>("NRE");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<string>("ENGINEERING");
  const [required, setRequired] = useState(false);

  // NRE 填报
  const [nreRows, setNreRows] = useState([{ definitionId: "", name: "", amount: "", note: "" }]);
  const [nreTaskId, setNreTaskId] = useState("");

  // 订单结果
  const [nextOutcome, setNextOutcome] = useState<QuoteOutcomeValue>(outcome);
  const [orderNo, setOrderNo] = useState(customerOrderNo ?? "");
  const [reason, setReason] = useState("");

  async function post(url: string, body: unknown, okNote: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `操作失败(HTTP ${res.status})`);
        return false;
      }
      setNote(data?.note ?? okNote);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const openTasks = tasks.filter((t) => t.status !== "SUBMITTED");
  const blocking = openTasks.filter((t) => t.required);

  return (
    <div data-testid="collab-panel">
      {error ? (
        <div className="banner warn" role="alert" data-testid="collab-error">
          {error}
        </div>
      ) : null}
      {note ? (
        <div className="banner soft" data-testid="collab-note">
          {note}
        </div>
      ) : null}

      {/* ---- 分项任务 ---- */}
      <h3 className="small" style={{ marginTop: 4 }}>
        分项任务(PM 派工)
      </h3>
      {tasks.length === 0 ? (
        <p className="small muted">尚未派工。报价可以照常做,派工只是把分项责任写清楚。</p>
      ) : (
        <div className="tbl-scroll">
          <table className="tbl" data-testid="task-table">
            <thead>
              <tr>
                <th>分项</th>
                <th>事项</th>
                <th>承接</th>
                <th>必须完成</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td className="small">{TASK_KIND_LABEL[t.kind]}</td>
                  <td>{t.title}</td>
                  <td className="small">{ROLE_LABEL[t.assignedRole] ?? t.assignedRole}</td>
                  <td className="small">{t.required ? "是" : "否"}</td>
                  <td className="small">
                    <span className={t.status === "SUBMITTED" ? "badge green" : "badge amber"}>
                      {TASK_STATUS_LABEL[t.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {blocking.length > 0 ? (
        <div className="banner warn" style={{ marginTop: 6 }} data-testid="blocking-tasks">
          有 <b>{blocking.length}</b> 项标记为「必须完成」的分项未回报价 —— <b>提交审批会被拦下</b>。
        </div>
      ) : null}

      {canAssign && !frozen ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>分项</span>
            <select aria-label="分项" value={kind} onChange={(e) => setKind(e.target.value as QuoteTaskKind)}>
              {(Object.keys(TASK_KIND_LABEL) as QuoteTaskKind[]).map((k) => (
                <option key={k} value={k}>
                  {TASK_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>事项</span>
            <input aria-label="事项" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>承接方</span>
            <select aria-label="承接方" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="checkbox"
              aria-label="必须完成才能提交"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            必须完成才能提交
          </label>
          <button
            className="btn"
            disabled={busy || !title.trim()}
            onClick={() =>
              void post(
                `/api/quotes/${versionId}/tasks`,
                { kind, title, assignedRole: role, required },
                "已派工",
              ).then((ok) => ok && setTitle(""))
            }
          >
            派工
          </button>
        </div>
      ) : null}

      <div className="divider" />

      {/* ---- NRE 填报 ---- */}
      <h3 className="small">NRE 填报</h3>
      <p className="small muted">
        客户 Q6:<b>工程填完直接回报价,不需要单独审批</b>。金额会写成 <b>NRE 分类的报价行</b>,
        直接进报价总额 —— 系统里不存在第二套 NRE 金额。
        {nreDefs.length === 0 ? (
          <>
            {" "}
            <b>NRE 项目字典尚未维护</b>(客户的标准清单待提供),现在可直接手填名称。
          </>
        ) : null}
      </p>
      {!frozen ? (
        <>
          {nreRows.map((row, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 6 }}
            >
              {nreDefs.length > 0 ? (
                <label className="fld" style={{ marginBottom: 0 }}>
                  <span>字典项</span>
                  <select
                    aria-label={`NRE 字典项 ${i + 1}`}
                    value={row.definitionId}
                    onChange={(e) => {
                      const def = nreDefs.find((d) => d.id === e.target.value);
                      setNreRows((rs) =>
                        rs.map((r, j) =>
                          j === i
                            ? {
                                ...r,
                                definitionId: e.target.value,
                                name: def?.name ?? r.name,
                                // 字典没给默认金额就**留空**,不填 0
                                amount: def?.defaultAmount ?? r.amount,
                              }
                            : r,
                        ),
                      );
                    }}
                  >
                    <option value="">手填</option>
                    {nreDefs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} · {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="fld" style={{ marginBottom: 0 }}>
                <span>项目名称</span>
                <input
                  aria-label={`NRE 名称 ${i + 1}`}
                  value={row.name}
                  onChange={(e) =>
                    setNreRows((rs) => rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                  }
                />
              </label>
              <label className="fld" style={{ marginBottom: 0 }}>
                <span>金额</span>
                <input
                  aria-label={`NRE 金额 ${i + 1}`}
                  value={row.amount}
                  placeholder="留空不会按 0 处理"
                  onChange={(e) =>
                    setNreRows((rs) => rs.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                  }
                />
              </label>
              <label className="fld" style={{ marginBottom: 0 }}>
                <span>备注</span>
                <input
                  aria-label={`NRE 备注 ${i + 1}`}
                  value={row.note}
                  onChange={(e) =>
                    setNreRows((rs) => rs.map((r, j) => (j === i ? { ...r, note: e.target.value } : r)))
                  }
                />
              </label>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <button
              className="btn"
              onClick={() => setNreRows((rs) => [...rs, { definitionId: "", name: "", amount: "", note: "" }])}
            >
              加一项
            </button>
            {openTasks.some((t) => t.kind === "NRE") ? (
              <label className="fld" style={{ marginBottom: 0 }}>
                <span>关联任务</span>
                <select
                  aria-label="关联 NRE 任务"
                  value={nreTaskId}
                  onChange={(e) => setNreTaskId(e.target.value)}
                >
                  <option value="">不关联</option>
                  {openTasks
                    .filter((t) => t.kind === "NRE")
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <button
              className="btn primary"
              disabled={busy}
              data-testid="nre-submit"
              onClick={() =>
                void post(
                  `/api/quotes/${versionId}/nre`,
                  {
                    taskId: nreTaskId || null,
                    items: nreRows.map((r) => ({
                      definitionId: r.definitionId || null,
                      name: r.name,
                      amount: r.amount,
                      note: r.note || null,
                    })),
                  },
                  "NRE 已写入报价行",
                )
              }
            >
              {busy ? "提交中…" : "填报并回到报价"}
            </button>
          </div>
        </>
      ) : (
        <p className="small muted">本版本已冻结,NRE 不能再改 —— 需要调整请新建 Revision。</p>
      )}

      <div className="divider" />

      {/* ---- 订单结果 ---- */}
      <h3 className="small">订单结果</h3>
      <p className="small muted">
        客户 Q7:<b>由人在报价单上标记</b>。系统没有 ERP 订单对接,
        <b>不会自动判定中标</b> —— 这里显示什么,就是有人这样标过。
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <span className={outcome === "WON" ? "badge green" : "badge gray"} data-testid="outcome-badge">
          {OUTCOME_LABEL[outcome]}
        </span>
        {customerOrderNo ? <span className="small">客户订单号:{customerOrderNo}</span> : null}
        {outcomeNote ? <span className="small muted">备注:{outcomeNote}</span> : null}
      </div>
      {canMarkOutcome ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>标记为</span>
            <select
              aria-label="订单结果"
              value={nextOutcome}
              onChange={(e) => setNextOutcome(e.target.value as QuoteOutcomeValue)}
            >
              {(Object.keys(OUTCOME_LABEL) as QuoteOutcomeValue[]).map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>客户订单号</span>
            <input aria-label="客户订单号" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>原因/备注</span>
            <input aria-label="结果备注" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            className="btn primary"
            disabled={busy}
            data-testid="outcome-submit"
            onClick={() =>
              void post(
                `/api/quotes/${versionId}/outcome`,
                { outcome: nextOutcome, customerOrderNo: orderNo || null, note: reason || null },
                "已更新订单结果",
              )
            }
          >
            保存结果
          </button>
        </div>
      ) : null}
      {!hasApprovedVersion ? (
        <p className="small muted" style={{ marginTop: 6 }}>
          这张报价还没有审批通过的版本 —— <b>标不了「已中标」</b>,没报出去的价谈不上中标。
        </p>
      ) : null}
    </div>
  );
}
