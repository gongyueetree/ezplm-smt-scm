"use client";

/**
 * F7(T2):制造工程信息四卡 —— 只读展示 + 表单录入。
 * 工艺变更审批/参数校验属工艺流程,本轮不做(下方注明)。
 * 无数据显示空态「待录入 / 待 MES 接入」,不放示例数据。
 */
import { useCallback, useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import type { ManufacturingInfo } from "@/lib/domain/bom-detail";

interface KvRow {
  label: string;
  value: string;
}

const EMPTY: ManufacturingInfo = {
  processRoute: [],
  panelization: [],
  stencil: [],
  tooling: [],
  note: null,
};

function KvEditor({
  title,
  rows,
  onChange,
  editing,
  testid,
}: {
  title: string;
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
  editing: boolean;
  testid: string;
}) {
  return (
    <Card title={title} sub={editing ? "逐行填写;空行保存时忽略" : undefined}>
      {rows.length === 0 && !editing ? (
        <p className="muted small" data-testid={`${testid}-empty`}>
          待录入 / 待 MES 接入
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-testid={testid}>
          {rows.map((r, i) =>
            editing ? (
              <div key={i} style={{ display: "flex", gap: 6 }}>
                <input
                  className="input-xs"
                  style={{ width: 140 }}
                  placeholder="项目"
                  value={r.label}
                  onChange={(e) =>
                    onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <input
                  className="input-xs"
                  style={{ flex: 1 }}
                  placeholder="内容"
                  value={r.value}
                  onChange={(e) =>
                    onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                />
                <button className="btn xs" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  删
                </button>
              </div>
            ) : (
              <div key={i} className="small">
                <b>{r.label}</b>:{r.value || "—"}
              </div>
            ),
          )}
          {editing ? (
            <button className="btn xs" onClick={() => onChange([...rows, { label: "", value: "" }])}>
              + 加一行
            </button>
          ) : null}
        </div>
      )}
      {rows.length === 0 && editing ? (
        <button className="btn xs" onClick={() => onChange([{ label: "", value: "" }])}>
          + 加一行
        </button>
      ) : null}
    </Card>
  );
}

export function ManufacturingPanel({ versionId, canEdit }: { versionId: string; canEdit: boolean }) {
  const [info, setInfo] = useState<ManufacturingInfo>(EMPTY);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bom/version/${versionId}/manufacturing`);
      if (res.ok) {
        const body = await res.json();
        setInfo(body.info);
        setUpdatedAt(body.updatedAt ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [versionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const cleaned: ManufacturingInfo = {
        ...info,
        processRoute: info.processRoute.filter((s) => s.process.trim()),
        panelization: info.panelization.filter((r) => r.label.trim()),
        stencil: info.stencil.filter((r) => r.label.trim()),
        tooling: info.tooling.filter((r) => r.label.trim()),
      };
      const res = await fetch(`/api/bom/version/${versionId}/manufacturing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleaned),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(body?.error ?? "保存失败");
        return;
      }
      setMsg("已保存");
      setEditing(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">加载中…</p>;

  const isEmpty =
    info.processRoute.length === 0 &&
    info.panelization.length === 0 &&
    info.stencil.length === 0 &&
    info.tooling.length === 0;

  return (
    <div data-testid="manufacturing-panel">
      <Banner tone="soft">
        <span>
          制造工程信息只做<b>录入与只读展示</b>;关键参数变更的 PE 审批属工艺流程,
          <b>本轮不实现</b>。{updatedAt ? `最近更新:${updatedAt.slice(0, 16).replace("T", " ")}` : ""}
        </span>
      </Banner>

      {canEdit ? (
        <div style={{ margin: "8px 0", display: "flex", gap: 8 }}>
          {editing ? (
            <>
              <button className="btn primary" disabled={busy} onClick={() => void save()} data-testid="mfg-save">
                {busy ? "保存中…" : "保存"}
              </button>
              <button className="btn" onClick={() => setEditing(false)}>
                取消
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setEditing(true)} data-testid="mfg-edit">
              {isEmpty ? "录入制造工程信息" : "编辑"}
            </button>
          )}
          {msg ? <span className="small muted">{msg}</span> : null}
        </div>
      ) : null}

      {isEmpty && !editing ? (
        <Card title="制造工程信息">
          <p className="muted" data-testid="mfg-empty">
            制造工程信息待录入 / 待 MES 接入 —— 不显示示例数据
          </p>
        </Card>
      ) : (
        <>
          <Card title="工艺路线" sub={editing ? "工序/工作中心/节拍(秒)/关键参数" : undefined}>
            {info.processRoute.length === 0 && !editing ? (
              <p className="muted small">待录入</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {info.processRoute.map((s, i) =>
                  editing ? (
                    <div key={i} style={{ display: "flex", gap: 6 }}>
                      <input
                        className="input-xs"
                        style={{ width: 44 }}
                        type="number"
                        value={s.seq}
                        onChange={(e) =>
                          setInfo((p) => ({
                            ...p,
                            processRoute: p.processRoute.map((x, j) =>
                              j === i ? { ...x, seq: Number(e.target.value) || 1 } : x,
                            ),
                          }))
                        }
                      />
                      <input
                        className="input-xs"
                        style={{ width: 120 }}
                        placeholder="工序"
                        value={s.process}
                        onChange={(e) =>
                          setInfo((p) => ({
                            ...p,
                            processRoute: p.processRoute.map((x, j) =>
                              j === i ? { ...x, process: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                      <input
                        className="input-xs"
                        style={{ width: 120 }}
                        placeholder="工作中心"
                        value={s.workCenter}
                        onChange={(e) =>
                          setInfo((p) => ({
                            ...p,
                            processRoute: p.processRoute.map((x, j) =>
                              j === i ? { ...x, workCenter: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                      <input
                        className="input-xs"
                        style={{ width: 90 }}
                        type="number"
                        placeholder="节拍(秒)"
                        value={s.taktSeconds ?? ""}
                        onChange={(e) =>
                          setInfo((p) => ({
                            ...p,
                            processRoute: p.processRoute.map((x, j) =>
                              j === i
                                ? { ...x, taktSeconds: e.target.value ? Number(e.target.value) : null }
                                : x,
                            ),
                          }))
                        }
                      />
                      <input
                        className="input-xs"
                        style={{ flex: 1 }}
                        placeholder="关键参数"
                        value={s.keyParams}
                        onChange={(e) =>
                          setInfo((p) => ({
                            ...p,
                            processRoute: p.processRoute.map((x, j) =>
                              j === i ? { ...x, keyParams: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                      <button
                        className="btn xs"
                        onClick={() =>
                          setInfo((p) => ({
                            ...p,
                            processRoute: p.processRoute.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        删
                      </button>
                    </div>
                  ) : (
                    <div key={i} className="small">
                      {s.seq}. <b>{s.process}</b> · {s.workCenter || "—"} · 节拍{" "}
                      {s.taktSeconds !== null ? `${s.taktSeconds}s` : "未知"}
                      {s.keyParams ? ` · ${s.keyParams}` : ""}
                    </div>
                  ),
                )}
                {editing ? (
                  <button
                    className="btn xs"
                    onClick={() =>
                      setInfo((p) => ({
                        ...p,
                        processRoute: [
                          ...p.processRoute,
                          {
                            seq: p.processRoute.length + 1,
                            process: "",
                            workCenter: "",
                            taktSeconds: null,
                            keyParams: "",
                          },
                        ],
                      }))
                    }
                  >
                    + 加工序
                  </button>
                ) : null}
              </div>
            )}
            {info.processRoute.length === 0 && editing ? (
              <button
                className="btn xs"
                onClick={() =>
                  setInfo((p) => ({
                    ...p,
                    processRoute: [
                      { seq: 1, process: "", workCenter: "", taktSeconds: null, keyParams: "" },
                    ],
                  }))
                }
              >
                + 加工序
              </button>
            ) : null}
          </Card>
          <KvEditor
            title="拼板规格"
            rows={info.panelization}
            editing={editing}
            testid="mfg-panelization"
            onChange={(rows) => setInfo((p) => ({ ...p, panelization: rows }))}
          />
          <KvEditor
            title="钢网"
            rows={info.stencil}
            editing={editing}
            testid="mfg-stencil"
            onChange={(rows) => setInfo((p) => ({ ...p, stencil: rows }))}
          />
          <KvEditor
            title="工装治具与程序版本"
            rows={info.tooling}
            editing={editing}
            testid="mfg-tooling"
            onChange={(rows) => setInfo((p) => ({ ...p, tooling: rows }))}
          />
        </>
      )}
    </div>
  );
}
