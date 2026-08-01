"use client";

/**
 * ERP 同步四步向导:连接配置 → 字段映射 → 同步策略 → 预览数据。
 *
 * 与截图的差别是**有意的**:截图里的「已连接 · 实时同步中」是虚假完成态。
 * 这里状态只反映真实测试结果,预览明确标注"未写入任何业务数据"。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { REQUIRED_LOCAL_FIELDS } from "@/lib/domain/erp-sync";

const VENDORS = [
  { id: "KINGDEE", name: "金蝶", editions: ["K3", "云星空", "星瀚"], real: "骨架" },
  { id: "YONYOU", name: "用友", editions: ["U8", "NC", "YonBIP"], real: "骨架" },
  { id: "SAP", name: "SAP", editions: ["B1", "S/4HANA"], real: "骨架" },
  { id: "ORACLE", name: "Oracle", editions: ["NetSuite", "EBS"], real: "骨架" },
  { id: "EXCEL", name: "Excel / CSV", editions: ["无 ERP 客户兜底"], real: "可用" },
  { id: "MOCK", name: "示例(Mock)", editions: ["演示"], real: "可用" },
] as const;

/** 各厂商的连接字段;敏感项走 secrets(加密保存,不回传) */
const CONFIG_FIELDS: Record<string, { key: string; label: string; secret?: boolean }[]> = {
  KINGDEE: [
    { key: "baseUrl", label: "数据中心地址" },
    { key: "dbId", label: "账套 / 数据库 ID" },
    { key: "appId", label: "第三方应用 ID" },
    { key: "username", label: "登录账号" },
    { key: "appSecret", label: "应用密钥 (AppSecret)", secret: true },
    { key: "password", label: "登录密码 / Token", secret: true },
  ],
  YONYOU: [
    { key: "baseUrl", label: "服务地址" },
    { key: "orgCode", label: "组织编码" },
    { key: "appKey", label: "应用 Key" },
    { key: "appSecret", label: "应用密钥", secret: true },
  ],
  SAP: [
    { key: "baseUrl", label: "网关地址" },
    { key: "client", label: "Client" },
    { key: "username", label: "集成用户" },
    { key: "password", label: "密码", secret: true },
  ],
  ORACLE: [
    { key: "baseUrl", label: "实例地址" },
    { key: "accountId", label: "Account ID" },
    { key: "token", label: "Token", secret: true },
  ],
  EXCEL: [],
  MOCK: [],
};

const ENTITIES = [
  { id: "MATERIAL", label: "物料主数据" },
  { id: "INVENTORY", label: "库存快照" },
  { id: "OPEN_PO", label: "未结采购订单" },
  { id: "WORK_ORDER", label: "工单" },
] as const;

interface Mapping {
  erpField: string;
  localField: string;
  transform: string;
  sampleValue: string;
}

export function ErpWizard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [vendor, setVendor] = useState<string>("EXCEL");
  const [edition, setEdition] = useState<string>("");
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [entity, setEntity] = useState<string>("MATERIAL");
  const [erpFields, setErpFields] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fields = CONFIG_FIELDS[vendor] ?? [];

  async function createConn() {
    setBusy("create");
    setError(null);
    try {
      const config: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const f of fields) {
        const v = values[f.key] ?? "";
        if (!v.trim()) continue;
        if (f.secret) secrets[f.key] = v;
        else config[f.key] = v;
      }
      const res = await fetch("/api/erp/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), vendor, edition: edition || null, config, secrets }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "创建失败");
        return;
      }
      setConnectionId(body.id);
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    if (!connectionId) return;
    setBusy("test");
    setError(null);
    try {
      const res = await fetch(`/api/erp/connections/${connectionId}/test`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "测试失败");
        return;
      }
      setTestResult(body.result);
      setStatus(body.status);
    } finally {
      setBusy(null);
    }
  }

  async function loadMapping(nextEntity: string) {
    if (!connectionId) return;
    setEntity(nextEntity);
    const res = await fetch(
      `/api/erp/connections/${connectionId}/mapping?entityType=${nextEntity}`,
    );
    if (!res.ok) return;
    const body = await res.json();
    setErpFields(body.erpFields ?? []);
    const required = REQUIRED_LOCAL_FIELDS[nextEntity] ?? [];
    setMappings(
      (body.mappings?.length
        ? body.mappings
        : required.map((f: string) => ({ erpField: "", localField: f, transform: "", sampleValue: "" }))
      ).map((m: Partial<Mapping>) => ({
        erpField: m.erpField ?? "",
        localField: m.localField ?? "",
        transform: m.transform ?? "",
        sampleValue: m.sampleValue ?? "",
      })),
    );
  }

  async function saveMapping() {
    if (!connectionId) return;
    setBusy("mapping");
    setError(null);
    try {
      const res = await fetch(`/api/erp/connections/${connectionId}/mapping`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: entity,
          mappings: mappings.map((m) => ({
            erpField: m.erpField,
            localField: m.localField,
            transform: m.transform || null,
            sampleValue: m.sampleValue || null,
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          `${body?.error ?? "保存失败"}${
            body?.issues ? `:${body.issues.map((i: { message: string }) => i.message).join(";")}` : ""
          }`,
        );
        return;
      }
      setStep(4);
    } finally {
      setBusy(null);
    }
  }

  async function runPreview(mode: "PREVIEW" | "EXECUTE") {
    if (!connectionId) return;
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch(`/api/erp/connections/${connectionId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: entity, mode }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "同步失败");
        return;
      }
      setPreview(body);
      if (mode === "EXECUTE") router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <Card title="ERP 系统同步" sub="连接配置 → 字段映射 → 同步策略 → 预览数据">
        <button className="btn primary" onClick={() => setOpen(true)}>
          配置 ERP 连接
        </button>
      </Card>
    );
  }

  const summary = preview?.summary as Record<string, number> | undefined;

  return (
    <Card title="ERP 系统同步" sub={`第 ${step} 步 / 共 4 步`}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {["连接配置", "字段映射", "同步策略", "预览数据"].map((s, i) => (
          <Badge key={s} tone={step === i + 1 ? "green" : "gray"}>
            {i + 1} {s}
          </Badge>
        ))}
        <button className="btn xs" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)}>
          关闭
        </button>
      </div>

      {step === 1 ? (
        <div data-testid="erp-step1">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {VENDORS.map((v) => (
              <button
                key={v.id}
                className={`btn sm${vendor === v.id ? " primary" : ""}`}
                onClick={() => {
                  setVendor(v.id);
                  setEdition(v.editions[0]);
                }}
              >
                {v.name}
                <Badge tone={v.real === "可用" ? "green" : "amber"}>
                  {v.real === "可用" ? "一期可用" : "待联调"}
                </Badge>
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label className="fld">
              <span>连接名称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 乾创金蝶生产账套" />
            </label>
            <label className="fld">
              <span>版本</span>
              <select value={edition} onChange={(e) => setEdition(e.target.value)}>
                {(VENDORS.find((v) => v.id === vendor)?.editions ?? []).map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {fields.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10 }}>
              {fields.map((f) => (
                <label className="fld" key={f.key}>
                  <span>
                    {f.label} {f.secret ? <Badge tone="amber">加密保存</Badge> : null}
                  </span>
                  <input
                    type={f.secret ? "password" : "text"}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="small muted">该通道无需连接凭据。</p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn" disabled={busy !== null || !name.trim()} onClick={() => void createConn()}>
              {busy === "create" ? "创建中…" : connectionId ? "已创建" : "创建连接"}
            </button>
            <button className="btn" disabled={!connectionId || busy !== null} onClick={() => void runTest()}>
              {busy === "test" ? "测试中…" : "测试连接"}
            </button>
            <button
              className="btn primary"
              disabled={!connectionId}
              onClick={() => {
                setStep(2);
                void loadMapping(entity);
              }}
            >
              下一步:字段映射 →
            </button>
          </div>

          {testResult ? (
            <div
              className={testResult.ok ? "banner soft" : "banner warn"}
              style={{ marginTop: 10 }}
              data-testid="erp-test-result"
            >
              <div>
                <b>状态:{status}</b> · 响应 {String(testResult.responseMs)}ms
                {testResult.erpVersion ? ` · 版本 ${String(testResult.erpVersion)}` : ""}
                {testResult.organization ? ` · 账套 ${String(testResult.organization)}` : ""}
              </div>
              {Array.isArray(testResult.capabilities) && testResult.capabilities.length > 0 ? (
                <div className="small">可用能力:{(testResult.capabilities as string[]).join("、")}</div>
              ) : null}
              {testResult.failureReason ? (
                <div className="small">失败原因:{String(testResult.failureReason)}</div>
              ) : null}
              {testResult.suggestion ? (
                <div className="small muted">建议:{String(testResult.suggestion)}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div data-testid="erp-step2">
          <label className="fld">
            <span>同步实体</span>
            <select value={entity} onChange={(e) => void loadMapping(e.target.value)}>
              {ENTITIES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">
            必需字段:{(REQUIRED_LOCAL_FIELDS[entity] ?? []).join("、")} —— 缺一项都<b>不允许保存映射</b>。
            填了样例值会在保存时跑一遍转换验证。
          </p>

          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>本系统字段</th>
                  <th>ERP 字段</th>
                  <th>转换</th>
                  <th>样例值</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m, i) => (
                  <tr key={i}>
                    <td className="mono small">{m.localField}</td>
                    <td>
                      <input
                        className="input-xs"
                        list="erp-fields"
                        value={m.erpField}
                        onChange={(e) =>
                          setMappings((p) => p.map((x, k) => (k === i ? { ...x, erpField: e.target.value } : x)))
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="input-xs"
                        value={m.transform}
                        onChange={(e) =>
                          setMappings((p) => p.map((x, k) => (k === i ? { ...x, transform: e.target.value } : x)))
                        }
                      >
                        <option value="">原样</option>
                        <option value="trim">trim</option>
                        <option value="upper">upper</option>
                        <option value="lower">lower</option>
                        <option value="decimal">decimal</option>
                        <option value="date">date</option>
                        <option value="date:YYYYMMDD">date:YYYYMMDD</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="input-xs"
                        value={m.sampleValue}
                        onChange={(e) =>
                          setMappings((p) => p.map((x, k) => (k === i ? { ...x, sampleValue: e.target.value } : x)))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="erp-fields">
              {erpFields.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              className="btn"
              onClick={() =>
                setMappings((p) => [...p, { erpField: "", localField: "", transform: "", sampleValue: "" }])
              }
            >
              添加一行
            </button>
            <button className="btn" onClick={() => setStep(1)}>
              ← 上一步
            </button>
            <button className="btn primary" disabled={busy !== null} onClick={() => void saveMapping()}>
              {busy === "mapping" ? "保存中…" : "保存映射并继续 →"}
            </button>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div data-testid="erp-step4">
          <p className="small muted">
            <b>预览只计算差异,不写入任何业务数据。</b>
            冲突不会被自动覆盖 —— 一律进人工处置队列;
            <b>来自 ezPLM 的物料行 ERP 不得覆盖</b>,会被判为冲突。
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled={busy !== null} onClick={() => void runPreview("PREVIEW")}>
              {busy === "PREVIEW" ? "预览中…" : "预览数据"}
            </button>
            <button
              className="btn primary"
              disabled={busy !== null || !preview}
              onClick={() => void runPreview("EXECUTE")}
            >
              {busy === "EXECUTE" ? "执行中…" : "执行同步"}
            </button>
            <button className="btn" onClick={() => setStep(2)}>
              ← 回到映射
            </button>
          </div>

          {summary ? (
            <div className="banner soft" style={{ marginTop: 10 }} data-testid="erp-preview-summary">
              新增 <b>{summary.created}</b> · 更新 <b>{summary.updated}</b> · 无变化{" "}
              <b>{summary.unchanged}</b> · <span style={{ color: "var(--danger)" }}>冲突 {summary.conflict}</span>{" "}
              · 跳过 <b>{summary.skipped}</b> · 失败 <b>{summary.failed}</b>
              {preview?.note ? <div className="small">{String(preview.note)}</div> : null}
              {preview?.duplicated ? <div className="small">⚠ 幂等键命中,已复用既有作业</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div>
          <p className="small muted">同步策略沿用缺省:仅导入 + 冲突进人工队列 + 执行前必须预览。</p>
          <button className="btn primary" onClick={() => setStep(4)}>
            下一步:预览数据 →
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="banner warn" style={{ marginTop: 10 }} data-testid="erp-error">
          {error}
        </div>
      ) : null}
    </Card>
  );
}
