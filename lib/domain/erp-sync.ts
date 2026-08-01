/**
 * ERP 同步编排的领域规则(纯函数,可完全单测)。
 *
 * 三件事:
 * ① 字段映射校验与转换;
 * ② 行级差异计算(预览用) —— **预览绝不写库**;
 * ③ 冲突判定 —— **双向同步不按最后更新时间自动覆盖**,一律进人工队列。
 *
 * 数据主权(最重要的一条,见 CLAUDE.md):
 * ezPLM 是物料主数据唯一真源。ERP 拉回来的物料**不得覆盖 origin=EZPLM 的行**,
 * 这类行一律判为冲突交人工,而不是"最后写的赢"。
 */

export type ErpEntity =
  | "MATERIAL"
  | "INVENTORY"
  | "OPEN_PO"
  | "WORK_ORDER"
  | "PURCHASE_ORDER"
  | "ETA_WRITEBACK"
  | "RECEIPT_LOT"
  | "SHIPMENT";

export type LineOutcome = "CREATED" | "UPDATED" | "UNCHANGED" | "CONFLICT" | "SKIPPED" | "FAILED";

/** 各实体的必需本系统字段 —— 缺了就不许执行同步 */
export const REQUIRED_LOCAL_FIELDS: Record<string, readonly string[]> = {
  MATERIAL: ["internalPn"],
  INVENTORY: ["internalPn", "qty"],
  OPEN_PO: ["poNo", "lineNo", "qtyOrdered"],
  WORK_ORDER: ["workOrderNo", "plannedQty"],
  PURCHASE_ORDER: ["poNo", "lineNo"],
  ETA_WRITEBACK: ["poNo", "lineNo"],
  RECEIPT_LOT: ["poNo", "lotNo", "qty"],
  SHIPMENT: ["shipmentNo", "qty"],
};

export interface FieldMapping {
  erpField: string;
  localField: string;
  transform?: string | null;
  defaultValue?: string | null;
  required?: boolean;
}

export interface MappingIssue {
  localField: string;
  message: string;
}

/**
 * 映射校验:必需字段必须被映射(或给了默认值)。
 * **缺必填字段时禁止执行同步** —— 允许跑下去只会写出一堆残缺行。
 */
export function validateMapping(entity: string, mappings: readonly FieldMapping[]): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const byLocal = new Map(mappings.map((m) => [m.localField, m]));

  for (const f of REQUIRED_LOCAL_FIELDS[entity] ?? []) {
    const m = byLocal.get(f);
    if (!m) {
      issues.push({ localField: f, message: `必需字段「${f}」尚未映射` });
      continue;
    }
    if (!m.erpField?.trim() && !m.defaultValue?.trim()) {
      issues.push({ localField: f, message: `「${f}」既没有 ERP 来源字段,也没有默认值` });
    }
  }

  // 同一个本系统字段被映射两次 → 结果不确定,必须拦下
  const seen = new Set<string>();
  for (const m of mappings) {
    if (seen.has(m.localField)) {
      issues.push({ localField: m.localField, message: `「${m.localField}」被重复映射` });
    }
    seen.add(m.localField);
  }
  return issues;
}

export interface TransformResult {
  ok: boolean;
  value: string | null;
  error?: string;
}

/**
 * 字段转换。
 * 转换失败**返回错误而不是吞掉** —— 静默变成 null 会让人以为 ERP 那边就是空的。
 */
export function applyTransform(raw: string | null, transform?: string | null): TransformResult {
  const v = raw ?? "";
  if (!transform || !transform.trim()) return { ok: true, value: raw };

  const [name, arg] = transform.split(":");
  switch (name) {
    case "trim":
      return { ok: true, value: v.trim() || null };
    case "upper":
      return { ok: true, value: v.trim().toUpperCase() || null };
    case "lower":
      return { ok: true, value: v.trim().toLowerCase() || null };
    case "number":
    case "decimal": {
      const t = v.trim().replace(/,/g, "");
      if (!t) return { ok: true, value: null };
      if (!/^-?\d+(\.\d+)?$/.test(t)) {
        return { ok: false, value: null, error: `「${v}」不是有效数值` };
      }
      return { ok: true, value: t };
    }
    case "date": {
      const t = v.trim();
      if (!t) return { ok: true, value: null };
      // date:YYYYMMDD 这类紧凑格式
      if (arg === "YYYYMMDD" && /^\d{8}$/.test(t)) {
        return { ok: true, value: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` };
      }
      const m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (m) {
        return { ok: true, value: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` };
      }
      return { ok: false, value: null, error: `「${v}」无法识别为日期` };
    }
    default:
      return { ok: false, value: null, error: `未知转换函数「${name}」` };
  }
}

/** 按映射把一行 ERP 记录转成本系统字段 */
export function mapRow(
  erpRow: Record<string, unknown>,
  mappings: readonly FieldMapping[],
): { values: Record<string, string | null>; errors: string[] } {
  const values: Record<string, string | null> = {};
  const errors: string[] = [];

  for (const m of mappings) {
    const rawValue = m.erpField ? erpRow[m.erpField] : undefined;
    const raw = rawValue === undefined || rawValue === null ? null : String(rawValue);
    const t = applyTransform(raw, m.transform);
    if (!t.ok) {
      errors.push(`${m.localField}: ${t.error}`);
      continue;
    }
    const finalValue = t.value ?? (m.defaultValue?.trim() ? m.defaultValue : null);
    if (m.required && (finalValue === null || finalValue === "")) {
      errors.push(`${m.localField}: 必填但 ERP 侧为空且无默认值`);
    }
    values[m.localField] = finalValue;
  }
  return { values, errors };
}

export interface DiffInput {
  bizKey: string;
  erpValues: Record<string, string | null>;
  /** 本系统现值;不存在时为 null(判为新增) */
  localValues: Record<string, string | null> | null;
  /**
   * 本地行的来源。`EZPLM` 表示这是 ezPLM 主数据缓存 ——
   * **ERP 不得覆盖它**,一律判冲突。
   */
  localOrigin?: string | null;
  /** 忽略比较的字段(如内部时间戳) */
  ignoreFields?: readonly string[];
}

export interface DiffResult {
  bizKey: string;
  outcome: LineOutcome;
  changedFields: string[];
  conflicts: { field: string; erpValue: string | null; localValue: string | null }[];
  message: string | null;
}

/**
 * 行级差异。
 *
 * - 本地没有 → CREATED
 * - 本地有但来自 ezPLM → **CONFLICT**(数据主权:ERP 不能覆盖 ezPLM 主数据)
 * - 有差异 → UPDATED(单向导入)或 CONFLICT(双向)
 * - 无差异 → UNCHANGED
 */
export function diffRow(input: DiffInput, options: { bidirectional?: boolean } = {}): DiffResult {
  const ignore = new Set(input.ignoreFields ?? []);

  if (!input.localValues) {
    return {
      bizKey: input.bizKey,
      outcome: "CREATED",
      changedFields: Object.keys(input.erpValues).filter((k) => !ignore.has(k)),
      conflicts: [],
      message: null,
    };
  }

  const changed: string[] = [];
  const conflicts: DiffResult["conflicts"] = [];
  for (const [field, erpValue] of Object.entries(input.erpValues)) {
    if (ignore.has(field)) continue;
    const localValue = input.localValues[field] ?? null;
    const a = (erpValue ?? "").trim();
    const b = (localValue ?? "").trim();
    if (a === b) continue;
    // ERP 侧为空**不算变更**:没给值不等于要清空本地值
    if (a === "") continue;
    changed.push(field);
    conflicts.push({ field, erpValue, localValue });
  }

  if (changed.length === 0) {
    return { bizKey: input.bizKey, outcome: "UNCHANGED", changedFields: [], conflicts: [], message: null };
  }

  if (input.localOrigin === "EZPLM") {
    return {
      bizKey: input.bizKey,
      outcome: "CONFLICT",
      changedFields: changed,
      conflicts,
      message:
        "本地行来自 ezPLM(物料主数据唯一真源),ERP 不得覆盖 —— 已转人工处理,请在 ezPLM 侧确认哪边为准",
    };
  }

  if (options.bidirectional) {
    return {
      bizKey: input.bizKey,
      outcome: "CONFLICT",
      changedFields: changed,
      conflicts,
      message: "双向同步下两侧都有值且不一致 —— 不按最后更新时间自动覆盖,转人工处理",
    };
  }

  return { bizKey: input.bizKey, outcome: "UPDATED", changedFields: changed, conflicts: [], message: null };
}

export interface PreviewSummary {
  created: number;
  updated: number;
  unchanged: number;
  conflict: number;
  skipped: number;
  failed: number;
  total: number;
}

export function summarizeDiff(rows: readonly DiffResult[]): PreviewSummary {
  const count = (o: LineOutcome) => rows.filter((r) => r.outcome === o).length;
  return {
    created: count("CREATED"),
    updated: count("UPDATED"),
    unchanged: count("UNCHANGED"),
    conflict: count("CONFLICT"),
    skipped: count("SKIPPED"),
    failed: count("FAILED"),
    total: rows.length,
  };
}

/**
 * 执行前的放行判定。
 *
 * - 有未处理冲突 + 策略 STOP_ON_CONFLICT → 不许执行;
 * - 策略 SKIP_ON_CONFLICT → 可执行,冲突行跳过;
 * - 策略 QUEUE_FOR_HUMAN → 可执行,冲突行入队列(仍不写)。
 */
export function canExecute(
  summary: PreviewSummary,
  conflictPolicy: "STOP_ON_CONFLICT" | "SKIP_ON_CONFLICT" | "QUEUE_FOR_HUMAN",
): { ok: true } | { ok: false; reason: string } {
  if (summary.failed > 0) {
    return { ok: false, reason: `有 ${summary.failed} 行解析失败 —— 请先修正字段映射或源数据` };
  }
  if (summary.conflict > 0 && conflictPolicy === "STOP_ON_CONFLICT") {
    return { ok: false, reason: `有 ${summary.conflict} 行冲突,当前策略为「冲突时停止」` };
  }
  return { ok: true };
}

/**
 * 幂等键:同一连接 + 实体 + 数据指纹 → 同一个键。
 * 重复执行同一批数据不会重复写入。
 */
export function syncIdempotencyKey(parts: {
  connectionId: string;
  entityType: string;
  mode: string;
  fingerprint: string;
}): string {
  return `${parts.connectionId}:${parts.entityType}:${parts.mode}:${parts.fingerprint}`;
}
