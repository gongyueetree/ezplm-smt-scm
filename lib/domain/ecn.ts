/**
 * F2:ECN-Lite 状态机与阶段推进(纯函数)。
 * 转移表见 docs/design/F2-CHECKPOINT-A.md §2 —— 本文件就是那张表的代码形。
 *
 * 铁律:
 * - 评审阶段固定顺序 ENGINEERING → PROCUREMENT → MANAGEMENT,租户可停用前两段,
 *   MANAGEMENT 不可停(批准必须有人负责);角色只取五值枚举;
 * - REVIEW 起头/行冻结,退回 DRAFT 才可改;
 * - RELEASED 不可作废(现实无法撤回),只能 CLOSE;
 * - Apply to BOM 不是状态转移:仅 RELEASED 可执行,且必须显式二次确认。
 */
import type { RoleName } from "@/lib/routes";

export type EcnStatusValue =
  | "DRAFT"
  | "REVIEW"
  | "CUSTOMER_CONFIRM"
  | "APPROVED"
  | "RELEASED"
  | "CLOSED"
  | "VOIDED";

export type EcnStageValue = "ENGINEERING" | "PROCUREMENT" | "MANAGEMENT";

export const ECN_STATUS_LABEL: Record<EcnStatusValue, string> = {
  DRAFT: "草稿",
  REVIEW: "评审中",
  CUSTOMER_CONFIRM: "待客户确认",
  APPROVED: "已批准",
  RELEASED: "已发布",
  CLOSED: "已关闭",
  VOIDED: "已作废",
};

export const ECN_STAGE_LABEL: Record<EcnStageValue, string> = {
  ENGINEERING: "工程评审",
  PROCUREMENT: "采购确认",
  MANAGEMENT: "管理批准",
};

export const ECN_TYPE_LABEL: Record<string, string> = {
  DESIGN_CHANGE: "设计变更",
  EOL_REPLACEMENT: "EOL 替换",
  PROCESS_CHANGE: "工艺变更",
  DOC_CHANGE: "文档变更",
  OTHER: "其它",
};

export const ECN_PRIORITY_LABEL: Record<string, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
  URGENT: "紧急",
};

export interface StageConfig {
  engineering: boolean;
  procurement: boolean;
}

/** 启用的阶段序列(顺序固定;MANAGEMENT 恒在) */
export function enabledStages(cfg: StageConfig): EcnStageValue[] {
  const stages: EcnStageValue[] = [];
  if (cfg.engineering) stages.push("ENGINEERING");
  if (cfg.procurement) stages.push("PROCUREMENT");
  stages.push("MANAGEMENT");
  return stages;
}

/** 阶段 → 谁可以批(该阶段角色;MANAGEMENT 兼可批一切阶段以防人员缺位) */
export function canDecideStage(stage: EcnStageValue, roles: readonly RoleName[]): boolean {
  if (roles.includes("MANAGEMENT")) return true;
  return roles.includes(stage as RoleName);
}

/** 已通过的阶段集合 → 当前待批阶段;全通过返回 null */
/** R3-5:提交时冻结的审批链快照(在途单只看它,不看实时配置) */
export interface EcnWorkflowSnapshot {
  stages: EcnStageValue[];
  frozenAt: string;
}

/** 从租户配置解析当前审批链(显式有序列表优先,否则由布尔启停推导) */
export function resolveApprovalStages(
  explicit: EcnStageValue[] | null | undefined,
  legacy: StageConfig,
): EcnStageValue[] {
  if (explicit && explicit.length > 0) return explicit;
  return enabledStages(legacy);
}

/** 解析已存的 workflowSnapshot;形状不对返回 null(调用方回落实时配置并如实标注) */
export function parseWorkflowSnapshot(raw: unknown): EcnWorkflowSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { stages?: unknown; frozenAt?: unknown };
  if (!Array.isArray(o.stages) || o.stages.length === 0) return null;
  const valid = new Set(["ENGINEERING", "PROCUREMENT", "MANAGEMENT"]);
  if (!o.stages.every((x) => typeof x === "string" && valid.has(x))) return null;
  if (o.stages[o.stages.length - 1] !== "MANAGEMENT") return null;
  return { stages: o.stages as EcnStageValue[], frozenAt: typeof o.frozenAt === "string" ? o.frozenAt : "" };
}

/** 列表版:下一个未通过阶段(全过返回 null) */
export function currentStageInList(
  stages: readonly EcnStageValue[],
  approvedStages: ReadonlySet<EcnStageValue>,
): EcnStageValue | null {
  for (const s of stages) {
    if (!approvedStages.has(s)) return s;
  }
  return null;
}

export function currentStage(
  cfg: StageConfig,
  approvedStages: ReadonlySet<EcnStageValue>,
): EcnStageValue | null {
  for (const s of enabledStages(cfg)) {
    if (!approvedStages.has(s)) return s;
  }
  return null;
}

/** 末段通过后的落点:需客户确认 → CUSTOMER_CONFIRM,否则 APPROVED */
export function statusAfterFinalApproval(needsCustomerConfirm: boolean): EcnStatusValue {
  return needsCustomerConfirm ? "CUSTOMER_CONFIRM" : "APPROVED";
}

export interface TransitionCheck {
  ok: boolean;
  reason: string | null;
}

const yes: TransitionCheck = { ok: true, reason: null };
const no = (reason: string): TransitionCheck => ({ ok: false, reason });

export function canSubmit(status: EcnStatusValue, lineCount: number): TransitionCheck {
  if (status !== "DRAFT") return no(`只有草稿可提交(当前:${ECN_STATUS_LABEL[status]})`);
  if (lineCount === 0) return no("至少需要一条变更行才能提交评审");
  return yes;
}

export function canReject(status: EcnStatusValue, reason: string | null): TransitionCheck {
  if (status !== "REVIEW") return no("只有评审中的 ECN 可退回");
  if (!reason?.trim()) return no("退回必须填写原因");
  return yes;
}

export function canCustomerConfirm(status: EcnStatusValue): TransitionCheck {
  return status === "CUSTOMER_CONFIRM" ? yes : no("只有待客户确认状态可执行此操作");
}

export function canRelease(status: EcnStatusValue): TransitionCheck {
  return status === "APPROVED" ? yes : no(`只有已批准的 ECN 可发布(当前:${ECN_STATUS_LABEL[status]})`);
}

export function canClose(status: EcnStatusValue): TransitionCheck {
  return status === "RELEASED" ? yes : no("只有已发布的 ECN 可关闭");
}

export function canVoid(status: EcnStatusValue, reason: string | null): TransitionCheck {
  if (status === "RELEASED") return no("已发布的 ECN 不可作废(现实无法撤回)—— 请关闭并另立新 ECN");
  if (status === "CLOSED" || status === "VOIDED") return no("终态不可作废");
  if (!reason?.trim()) return no("作废必须填写原因");
  return yes;
}

export function canApplyToBom(status: EcnStatusValue): TransitionCheck {
  return status === "RELEASED"
    ? yes
    : no(`只有已发布的 ECN 可执行 Apply to BOM(当前:${ECN_STATUS_LABEL[status]})`);
}

/** 头/行是否冻结:REVIEW 起冻结,退回 DRAFT 才解冻 */
export function isFrozen(status: EcnStatusValue): boolean {
  return status !== "DRAFT";
}

// ---- 变更行 CSV 导入(模板列固定,复用 parseCsv) ----

export const ECN_LINE_COLUMNS = [
  "旧内部料号",
  "旧MPN",
  "新内部料号",
  "新MPN",
  "数量影响",
  "原因",
  "工程备注",
] as const;

export interface ParsedEcnLine {
  oldInternalPn: string | null;
  oldMpn: string | null;
  newInternalPn: string | null;
  newMpn: string | null;
  qtyImpact: string | null;
  reason: string | null;
  engineeringNote: string | null;
}

export function parseEcnLineRows(rows: readonly (readonly string[])[]): {
  lines: ParsedEcnLine[];
  errors: string[];
} {
  const lines: ParsedEcnLine[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const rowNo = i + 2; // 表头占第 1 行
    const [oldPn, oldMpn, newPn, newMpn, qty, reason, note] = r.map((c) => c?.trim() || null);
    if (!oldPn && !oldMpn) {
      errors.push(`第 ${rowNo} 行:旧内部料号与旧 MPN 至少填一个`);
      return;
    }
    if (qty && !/^-?\d+(\.\d+)?$/.test(qty)) {
      errors.push(`第 ${rowNo} 行:数量影响「${qty}」不是数字(未知请留空,不要填 0)`);
      return;
    }
    lines.push({
      oldInternalPn: oldPn,
      oldMpn,
      newInternalPn: newPn,
      newMpn,
      qtyImpact: qty,
      reason,
      engineeringNote: note,
    });
  });
  return { lines, errors };
}

/** ECN 编号:ECN-YYYYMMDD-序号(创建时按当日已有数递增;冲突由唯一索引兜底重试) */
export function buildEcnCode(date: Date, seq: number): string {
  const ymd = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `ECN-${ymd}-${String(seq).padStart(3, "0")}`;
}
