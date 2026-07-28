/**
 * RFQ 状态机(SPEC §5)。
 * 纯函数:只判断"能否流转"与"流转需要什么",不碰数据库。
 * 落库时由 repository 在同一事务内写 RFQStatusHistory + AuditLog。
 */
import type { RoleName } from "@/lib/routes";

export const RFQ_STATUSES = [
  "DRAFT",
  "RECEIVED",
  "PARSING",
  "WAITING_ENGINEERING",
  "WAITING_PROCUREMENT",
  "QUOTING",
  "PENDING_APPROVAL",
  "QUOTED",
  "CLOSED_NO_QUOTE",
  "LOST",
] as const;

export type RfqStatusValue = (typeof RFQ_STATUSES)[number];

/** 终态:不可再流转 */
export const TERMINAL_STATUSES: readonly RfqStatusValue[] = ["CLOSED_NO_QUOTE", "LOST"];

export const RFQ_STATUS_LABELS: Record<RfqStatusValue, string> = {
  DRAFT: "草稿",
  RECEIVED: "已接收",
  PARSING: "解析中",
  WAITING_ENGINEERING: "待工程",
  WAITING_PROCUREMENT: "待采购",
  QUOTING: "报价中",
  PENDING_APPROVAL: "待审批",
  QUOTED: "已报价",
  CLOSED_NO_QUOTE: "不报价关闭",
  LOST: "丢单",
};

interface TransitionRule {
  to: RfqStatusValue;
  /** 可执行该流转的角色;MANAGEMENT 恒可执行 */
  roles: RoleName[];
  /** 是否必须填写原因 */
  requiresReason?: boolean;
}

/**
 * 允许的流转图。
 * 设计要点:
 * - "不报价并关闭"(CLOSED_NO_QUOTE)在任何非终态都可执行,但必须填原因(SPEC §5 的关闭按钮);
 * - 工程/采购只能推进自己那一段(WAITING_ENGINEERING / WAITING_PROCUREMENT);
 * - PENDING_APPROVAL 退回 QUOTING 必须填原因(审批退回要留痕)。
 */
const TRANSITIONS: Record<RfqStatusValue, TransitionRule[]> = {
  DRAFT: [{ to: "RECEIVED", roles: ["PM"] }],
  RECEIVED: [
    { to: "PARSING", roles: ["PM", "ENGINEERING"] },
    { to: "WAITING_ENGINEERING", roles: ["PM"] },
    { to: "WAITING_PROCUREMENT", roles: ["PM"] },
  ],
  PARSING: [
    { to: "WAITING_ENGINEERING", roles: ["PM", "ENGINEERING"] },
    { to: "WAITING_PROCUREMENT", roles: ["PM", "ENGINEERING"] },
    { to: "QUOTING", roles: ["PM"] },
  ],
  WAITING_ENGINEERING: [
    { to: "WAITING_PROCUREMENT", roles: ["PM", "ENGINEERING"] },
    { to: "QUOTING", roles: ["PM", "ENGINEERING"] },
  ],
  WAITING_PROCUREMENT: [
    { to: "WAITING_ENGINEERING", roles: ["PM", "PROCUREMENT"] },
    { to: "QUOTING", roles: ["PM", "PROCUREMENT"] },
  ],
  QUOTING: [
    { to: "WAITING_ENGINEERING", roles: ["PM"] },
    { to: "WAITING_PROCUREMENT", roles: ["PM"] },
    { to: "PENDING_APPROVAL", roles: ["PM"] },
  ],
  PENDING_APPROVAL: [
    { to: "QUOTED", roles: ["MANAGEMENT"] },
    { to: "QUOTING", roles: ["MANAGEMENT"], requiresReason: true },
  ],
  QUOTED: [{ to: "LOST", roles: ["PM"], requiresReason: true }],
  CLOSED_NO_QUOTE: [],
  LOST: [],
};

/** 任何非终态都可"不报价并关闭",必须填原因(SPEC §5) */
const CLOSE_NO_QUOTE_RULE: TransitionRule = {
  to: "CLOSED_NO_QUOTE",
  roles: ["PM"],
  requiresReason: true,
};

export function isTerminal(status: RfqStatusValue): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** 某状态下允许的所有流转(含"不报价关闭") */
export function allowedTransitions(from: RfqStatusValue): TransitionRule[] {
  if (isTerminal(from)) return [];
  return [...TRANSITIONS[from], CLOSE_NO_QUOTE_RULE];
}

export type TransitionRejection =
  | { ok: false; code: "terminal"; message: string }
  | { ok: false; code: "not_allowed"; message: string }
  | { ok: false; code: "forbidden_role"; message: string }
  | { ok: false; code: "reason_required"; message: string };

export type TransitionResult = { ok: true; requiresReason: boolean } | TransitionRejection;

export interface TransitionInput {
  from: RfqStatusValue;
  to: RfqStatusValue;
  roles: RoleName[];
  reason?: string | null;
}

/**
 * 校验一次状态流转。
 * 顺序:终态 → 是否允许 → 角色 → 原因,任一不满足即拒绝并给出结构化原因。
 */
export function checkTransition(input: TransitionInput): TransitionResult {
  const { from, to, roles, reason } = input;

  if (isTerminal(from)) {
    return {
      ok: false,
      code: "terminal",
      message: `${RFQ_STATUS_LABELS[from]} 为终态,不可再流转`,
    };
  }

  const rule = allowedTransitions(from).find((r) => r.to === to);
  if (!rule) {
    return {
      ok: false,
      code: "not_allowed",
      message: `不允许从 ${RFQ_STATUS_LABELS[from]} 流转到 ${RFQ_STATUS_LABELS[to]}`,
    };
  }

  const permitted = roles.includes("MANAGEMENT") || rule.roles.some((r) => roles.includes(r));
  if (!permitted) {
    return {
      ok: false,
      code: "forbidden_role",
      message: `当前角色无权执行「${RFQ_STATUS_LABELS[from]} → ${RFQ_STATUS_LABELS[to]}」`,
    };
  }

  if (rule.requiresReason && !reason?.trim()) {
    return {
      ok: false,
      code: "reason_required",
      message: `流转到 ${RFQ_STATUS_LABELS[to]} 必须填写原因`,
    };
  }

  return { ok: true, requiresReason: !!rule.requiresReason };
}

/** 当前角色在该状态下可选的流转目标(供 UI 渲染按钮) */
export function availableTransitionsFor(
  from: RfqStatusValue,
  roles: RoleName[],
): { to: RfqStatusValue; label: string; requiresReason: boolean }[] {
  return allowedTransitions(from)
    .filter((r) => roles.includes("MANAGEMENT") || r.roles.some((x) => roles.includes(x)))
    .map((r) => ({
      to: r.to,
      label: RFQ_STATUS_LABELS[r.to],
      requiresReason: !!r.requiresReason,
    }));
}
