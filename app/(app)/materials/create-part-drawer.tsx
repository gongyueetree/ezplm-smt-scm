"use client";

/**
 * 新增物料抽屉(不跳独立空白页)。
 *
 * 分区与截图一致:基本信息 / 规格参数 / 供应与库存 / 合规与文档 / 备注。
 *
 * 三条纪律直接体现在交互里:
 * - **疑似重复不允许静默创建** —— 命中后必须选处置,「仍然创建」还要写原因;
 * - **ezPLM 引用只预填,不代替确认** —— 预填字段带来源徽标;
 * - **AI 只填空** —— 已填字段不会被提取结果覆盖(合并逻辑在 lib/domain/part-create.ts)。
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_L1 } from "@/lib/domain/part-category";
import type { DuplicateCandidate } from "@/lib/domain/part-create";

interface AttrDef {
  id: string;
  key: string;
  label: string;
  type: string;
  unit: string | null;
  required: boolean;
}

type Form = Record<string, string>;

const EMPTY: Form = {
  internalPn: "",
  mpn: "",
  categoryL1: "",
  categoryL2: "",
  manufacturer: "",
  description: "",
  descriptionEn: "",
  brand: "",
  footprint: "",
  msl: "",
  packaging: "",
  reelQty: "",
  moq: "",
  spq: "",
  leadTimeDays: "",
  safetyStock: "",
  supplierId: "",
  supplierPn: "",
  referencePrice: "",
  currency: "CNY",
  rohs: "",
  reach: "",
  note: "",
};

export function CreatePartDrawer({
  suppliers,
  canCreate,
}: {
  suppliers: { id: string; name: string }[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [attrs, setAttrs] = useState<AttrDef[]>([]);
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [prefilled, setPrefilled] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [dupDegraded, setDupDegraded] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string>("");
  const [dupReason, setDupReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  // 分类变了就换一套动态参数模板
  useEffect(() => {
    if (!open || !form.categoryL1) {
      setAttrs([]);
      return;
    }
    const q = new URLSearchParams({ categoryL1: form.categoryL1 });
    if (form.categoryL2) q.set("categoryL2", form.categoryL2);
    void fetch(`/api/materials/attribute-definitions?${q}`)
      .then((r) => (r.ok ? r.json() : { definitions: [] }))
      .then((b) => setAttrs(b.definitions ?? []));
  }, [open, form.categoryL1, form.categoryL2]);

  const blocking = useMemo(() => candidates?.some((c) => c.blocking) ?? false, [candidates]);
  const needsResolution = (candidates?.length ?? 0) > 0 && !blocking;

  async function checkDuplicate() {
    if (!form.internalPn.trim()) {
      setError("请先填写内部料号再查重");
      return;
    }
    setBusy("dup");
    setError(null);
    try {
      const res = await fetch("/api/materials/parts/duplicate-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalPn: form.internalPn, mpn: form.mpn || null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "查重失败");
        return;
      }
      setCandidates(body.candidates ?? []);
      setDupDegraded(body.degraded ?? null);
    } finally {
      setBusy(null);
    }
  }

  async function pullFromEzplm() {
    if (!form.mpn.trim()) {
      setError("请先填写 MPN");
      return;
    }
    setBusy("ezplm");
    setError(null);
    try {
      const res = await fetch("/api/materials/parts/ezplm-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mpn: form.mpn }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "引用失败");
        return;
      }
      const p = body.prefill as Record<string, unknown>;
      const filled = new Set(prefilled);
      setForm((prev) => {
        const next = { ...prev };
        const put = (k: string, v: unknown) => {
          // 只填空:已填的一律保留(与 mergeExtracted 同一条铁律)
          if (v === null || v === undefined || String(v).trim() === "") return;
          if (next[k]?.trim()) return;
          next[k] = String(v);
          filled.add(k);
        };
        put("manufacturer", p.manufacturer);
        put("description", p.description);
        put("footprint", p.footprint);
        put("msl", p.msl);
        put("packaging", p.packaging);
        if (typeof p.rohs === "boolean") put("rohs", p.rohs ? "true" : "false");
        if (typeof p.reach === "boolean") put("reach", p.reach ? "true" : "false");
        return next;
      });
      setPrefilled(filled);
    } finally {
      setBusy(null);
    }
  }

  async function submit(target: "DRAFT" | "ACTIVE") {
    setBusy(target);
    setError(null);
    setIssues([]);
    try {
      const res = await fetch("/api/materials/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          internalPn: form.internalPn || null,
          mpn: form.mpn || null,
          manufacturer: form.manufacturer || null,
          description: form.description || null,
          descriptionEn: form.descriptionEn || null,
          brand: form.brand || null,
          note: form.note || null,
          categoryL1: form.categoryL1 || null,
          categoryL2: form.categoryL2 || null,
          footprint: form.footprint || null,
          rohs: form.rohs === "" ? null : form.rohs === "true",
          reach: form.reach === "" ? null : form.reach === "true",
          msl: form.msl || null,
          packaging: form.packaging || null,
          reelQty: form.reelQty ? Number(form.reelQty) : null,
          moq: form.moq ? Number(form.moq) : null,
          spq: form.spq ? Number(form.spq) : null,
          leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : null,
          safetyStock: form.safetyStock || null,
          supplierId: form.supplierId || null,
          supplierPn: form.supplierPn || null,
          referencePrice: form.referencePrice || null,
          currency: form.currency || "CNY",
          createdVia: prefilled.size > 0 ? "EZPLM_REFERENCE" : "MANUAL",
          duplicateResolution: resolution || null,
          duplicateReason: dupReason || null,
          attributes: Object.fromEntries(
            Object.entries(attrValues)
              .filter(([, v]) => v.trim())
              .map(([id, v]) => [id, { value: v, source: "MANUAL" }]),
          ),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `创建失败(HTTP ${res.status})`);
        setIssues(body?.issues ?? []);
        if (body?.candidates) setCandidates(body.candidates);
        return;
      }
      setOpen(false);
      setForm(EMPTY);
      router.push(`/materials/${encodeURIComponent(form.mpn || form.internalPn)}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!canCreate) return null;

  if (!open) {
    return (
      <button className="btn primary" onClick={() => setOpen(true)}>
        + 新增物料
      </button>
    );
  }

  const srcBadge = (k: string) =>
    prefilled.has(k) ? (
      <Badge tone="blue">取自 ezPLM</Badge>
    ) : null;

  return (
    <div className="drawer-backdrop" data-testid="create-part-drawer">
      <div className="drawer-panel">
        <div className="drawer-head">
          <div>
            <h2 className="page-title">新增物料</h2>
            <p className="page-desc">维护物料主数据 · 标 * 为必填项</p>
          </div>
          <button className="btn xs" onClick={() => setOpen(false)} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="banner ai">
          <span>
            填入 MPN 后可点<b>「从 ezPLM 引用」</b>预填字段;上传规格书后 AI 可辅助提取参数。
            两者都<b>只填空,不覆盖你已经填过的值</b>,且需你确认后才随物料一起保存。
          </span>
        </div>

        {/* 基本信息 */}
        <section>
          <h3 className="sec-title">基本信息</h3>
          <div className="grid2">
            <label className="fld">
              <span>内部料号 *</span>
              <input
                value={form.internalPn}
                onChange={(e) => set("internalPn", e.target.value)}
                placeholder="如 EE-IC-STM32F103-C8"
              />
              <small className="muted">规则:EE-[类别]-[型号];同租户内不可重复</small>
            </label>
            <label className="fld">
              <span>制造商料号 (MPN) *</span>
              <input
                value={form.mpn}
                onChange={(e) => set("mpn", e.target.value)}
                placeholder="如 STM32F103C8T6"
              />
            </label>
            <label className="fld">
              <span>物料分类 *</span>
              <select value={form.categoryL1} onChange={(e) => set("categoryL1", e.target.value)}>
                <option value="">请选择</option>
                {CATEGORY_L1.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld">
              <span>二级分类</span>
              <input
                value={form.categoryL2}
                onChange={(e) => set("categoryL2", e.target.value)}
                placeholder="如 MCU / 电源-LDO"
              />
            </label>
            <label className="fld">
              <span>制造商 * {srcBadge("manufacturer")}</span>
              <input
                value={form.manufacturer}
                onChange={(e) => set("manufacturer", e.target.value)}
                placeholder="如 STMicroelectronics"
              />
            </label>
            <label className="fld">
              <span>品牌</span>
              <input value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            </label>
          </div>
          <label className="fld">
            <span>中文描述 * {srcBadge("description")}</span>
            <input
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="如 ARM® Cortex®-M3 32-bit MCU"
            />
          </label>
          <label className="fld">
            <span>英文描述</span>
            <input value={form.descriptionEn} onChange={(e) => set("descriptionEn", e.target.value)} />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn sm" disabled={busy !== null} onClick={() => void pullFromEzplm()}>
              {busy === "ezplm" ? "读取中…" : "从 ezPLM 引用"}
            </button>
            <button className="btn sm" disabled={busy !== null} onClick={() => void checkDuplicate()}>
              {busy === "dup" ? "查重中…" : "检查是否重复"}
            </button>
          </div>
        </section>

        {/* 重复候选 */}
        {candidates !== null ? (
          <section data-testid="dup-result">
            {candidates.length === 0 ? (
              <p className="small muted">
                未发现重复。
                {dupDegraded ? <> ⚠ {dupDegraded} —— 该侧未查到不等于不存在。</> : null}
              </p>
            ) : (
              <div className={blocking ? "banner warn" : "banner soft"}>
                <b>
                  {blocking ? "存在阻断性重复,不能创建" : `发现 ${candidates.length} 条疑似重复`}
                </b>
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {candidates.map((c, i) => (
                    <li key={i} className="small">
                      <Badge tone={c.from === "EZPLM" ? "blue" : "gray"}>{c.from}</Badge> {c.reason}
                    </li>
                  ))}
                </ul>
                {dupDegraded ? <div className="small muted">⚠ {dupDegraded}</div> : null}

                {needsResolution ? (
                  <div style={{ marginTop: 8 }}>
                    <label className="fld">
                      <span>处置方式(必选)</span>
                      <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                        <option value="">请选择</option>
                        <option value="USE_EXISTING">使用已有物料(不创建)</option>
                        <option value="MAP_CUSTOMER_PN">建立客户料号映射</option>
                        <option value="CREATE_ANYWAY">仍然创建新物料</option>
                      </select>
                    </label>
                    {resolution === "CREATE_ANYWAY" ? (
                      <label className="fld">
                        <span>原因(必填)</span>
                        <input
                          value={dupReason}
                          onChange={(e) => setDupReason(e.target.value)}
                          placeholder="如:同 MPN 但封装不同,需分开管理"
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {/* 规格参数(分类驱动) */}
        <section>
          <h3 className="sec-title">
            规格参数 {form.categoryL1 ? <Badge tone="purple">按「{form.categoryL1}」加载</Badge> : null}
          </h3>
          <div className="grid3">
            <label className="fld">
              <span>封装 {srcBadge("footprint")}</span>
              <input value={form.footprint} onChange={(e) => set("footprint", e.target.value)} placeholder="如 LQFP-48" />
            </label>
            <label className="fld">
              <span>湿敏等级 MSL {srcBadge("msl")}</span>
              <select value={form.msl} onChange={(e) => set("msl", e.target.value)}>
                <option value="">未指定</option>
                {["MSL1", "MSL2", "MSL2A", "MSL3", "MSL4", "MSL5", "MSL6"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld">
              <span>包装方式 {srcBadge("packaging")}</span>
              <input value={form.packaging} onChange={(e) => set("packaging", e.target.value)} placeholder="如 T&R" />
            </label>
            {attrs.map((d) => (
              <label className="fld" key={d.id}>
                <span>
                  {d.label}
                  {d.unit ? ` (${d.unit})` : ""}
                  {d.required ? " *" : ""}
                </span>
                <input
                  value={attrValues[d.id] ?? ""}
                  onChange={(e) => setAttrValues((p) => ({ ...p, [d.id]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          {form.categoryL1 && attrs.length === 0 ? (
            <p className="small muted">该分类暂无扩展参数模板 —— 可在系统设置中维护属性定义。</p>
          ) : null}
        </section>

        {/* 供应与库存 */}
        <section>
          <h3 className="sec-title">供应与库存</h3>
          <p className="small muted">
            这里填的是<b>初始参考</b>。正式价格仍来自 DigiKey / Mouser / ezPLM / 线下供应商报价 / 历史采购价,
            <b>建料不等于建立正式采购报价</b>。
          </p>
          <div className="grid3">
            <label className="fld">
              <span>默认供应商</span>
              <select value={form.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
                <option value="">未指定</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld">
              <span>供应商料号</span>
              <input value={form.supplierPn} onChange={(e) => set("supplierPn", e.target.value)} />
            </label>
            <label className="fld">
              <span>参考单价</span>
              <input value={form.referencePrice} onChange={(e) => set("referencePrice", e.target.value)} placeholder="如 4.85" />
            </label>
            <label className="fld">
              <span>最小起订量 MOQ</span>
              <input value={form.moq} onChange={(e) => set("moq", e.target.value)} placeholder="如 100" />
            </label>
            <label className="fld">
              <span>最小包装 SPQ</span>
              <input value={form.spq} onChange={(e) => set("spq", e.target.value)} placeholder="如 5000" />
            </label>
            <label className="fld">
              <span>Lead Time(天)</span>
              <input value={form.leadTimeDays} onChange={(e) => set("leadTimeDays", e.target.value)} placeholder="如 14" />
            </label>
            <label className="fld">
              <span>盘装数量</span>
              <input value={form.reelQty} onChange={(e) => set("reelQty", e.target.value)} />
            </label>
            <label className="fld">
              <span>安全库存</span>
              <input value={form.safetyStock} onChange={(e) => set("safetyStock", e.target.value)} placeholder="如 500" />
            </label>
          </div>
        </section>

        {/* 合规与文档 */}
        <section>
          <h3 className="sec-title">合规与文档</h3>
          <div className="grid2">
            <label className="fld">
              <span>RoHS {srcBadge("rohs")}</span>
              <select value={form.rohs} onChange={(e) => set("rohs", e.target.value)}>
                <option value="">未知</option>
                <option value="true">符合</option>
                <option value="false">不符合</option>
              </select>
            </label>
            <label className="fld">
              <span>REACH {srcBadge("reach")}</span>
              <select value={form.reach} onChange={(e) => set("reach", e.target.value)}>
                <option value="">未知</option>
                <option value="true">符合</option>
                <option value="false">不符合</option>
              </select>
            </label>
          </div>
          <p className="small muted">
            规格书 / 承认书 / RoHS 报告等文档,可在创建后于物料详情页上传并登记有效期与版本。
          </p>
        </section>

        <label className="fld">
          <span>备注</span>
          <textarea rows={3} value={form.note} onChange={(e) => set("note", e.target.value)} />
        </label>

        {issues.length > 0 ? (
          <div className="banner warn" data-testid="create-part-issues">
            {issues.map((i, k) => (
              <div key={k} className="small">
                {i.message}
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <div className="banner warn" data-testid="create-part-error">
            {error}
          </div>
        ) : null}

        <div className="drawer-foot">
          <span className="small muted">创建后可在物料详情页继续完善替代料、客户料号与文档</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => void submit("DRAFT")}>
              {busy === "DRAFT" ? "保存中…" : "保存草稿"}
            </button>
            <button
              className="btn primary"
              disabled={busy !== null || blocking}
              onClick={() => void submit("ACTIVE")}
            >
              {busy === "ACTIVE" ? "创建中…" : "创建物料"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
