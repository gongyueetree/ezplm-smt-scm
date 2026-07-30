/**
 * 采购订单(PO)状态机(客户 xlsx「采购订单全流程创建、审批、跟踪」+「采购价格复核、修正与多级审批流」)。
 *
 * 与报价状态机同构,但多一道**价格复核**环节 —— 客户把它单列为一条需求:
 * 采购自己录的价要先经复核(核历史价与阈值),复核过了才进主管终审。
 *
 * 纪律(与报价一致,逐条以纯函数固化):
 * 1. DRAFT → PENDING_PRICE_REVIEW → PENDING_APPROVAL → APPROVED / REJECTED;
 * 2. **有异常行未处理不得提交复核**(与报价"分类未确认不得提交"同理);
 * 3. PENDING_* / APPROVED 下行项与价格**全冻结**;
 * 4. 退回必须记原因;
 * 5. **已批准不可覆盖** —— 要改只能作废后新建,并记 supersededBy;
 * 6. APPROVED 之后只有"已导出 ERP 模板"这一个前进方向。
 *    本系统**不是下单执行的真源**:ERP 才是。所以没有「已下单」这个状态,
 *    只有 EXPORTED(已导出 ERP 可导入模板),避免虚假完成态。
 */
import type { RoleName } from "@/lib/routes";

export const PO_STATUSES = [
  "DRAFT",
  "PENDING_PRICE_REVIEW",
  "PENDING_APPROVAL",
  "APPROVED",
  "EXPORTED",
  "REJECTED",
  "CANCELLED",
] as const;

export type PoStatusValue = (typeof PO_STATUSES)[number];

export const PO_STATUS_LABELS: Record<PoStatusValue, string> = {
  DRAFT: "草稿",
  PENDING_PRICE_REVIEW: "待价格复核",
  PENDING_APPROVAL: "待审批",
  APPROVED: "已审批 · 待 ERP 录入",
  EXPORTED: "已导出 ERP 模板",
  REJECTED: "已退回",
  CANCELLED: "已作废",
};

/** 冻结态:这些状态下任何行项/价格修改都必须被拒(规则 3) */
export const PO_FROZEN_STATUSES: readonly PoStatusValue[] = [
  "PENDING_PRICE_REVIEW",
  "PENDING_APPROVAL",
  "APPROVED",
  "EXPORTED",
  "CANCELLED",
];

/** 终态:本单据到此为止(REJECTED 可退回草稿继续改,故不算终态) */
export const PO_TERMINAL_STATUSES: readonly PoStatusValue[] = ["EXPORTED", "CANCELLED"];

export function isPoFrozen(status: PoStatusValue): boolean {
  return PO_FROZEN_STATUSES.includes(status);
}

export function isPoTerminal(status: PoStatusValue): boolean {
  return PO_TERMINAL_STATUSES.includes(status);
}

interface PoTransitionRule {
  to: PoStatusValue;
  roles: RoleName[];
  requiresReason?: boolean;
  /** 是否要求异常行已全部处理 */
  requiresFlagsResolved?: boolean;
}

const PO_TRANSITIONS: Record<PoStatusValue, PoTransitionRule[]> = {
  DRAFT: [
    { to: "PENDING_PRICE_REVIEW", roles: ["PROCUREMENT"], requiresFlagsResolved: true },
    { to: "CANCELLED", roles: ["PROCUREMENT"], requiresReason: true },
  ],
  // 价格复核由采购(非制单人)或管理层执行;复核不通过退回草稿
  PENDING_PRICE_REVIEW: [
    { to: "PENDING_APPROVAL", roles: ["PROCUREMENT"] },
    { to: "REJECTED", roles: ["PROCUREMENT"], requiresReason: true },
  ],
  PENDING_APPROVAL: [
    { to: "APPROVED", roles: ["MANAGEMENT"] },
    { to: "REJECTED", roles: ["MANAGEMENT"], requiresReason: true },
  ],
  // 已批准只能前进到"已导出 ERP 模板",或作废(记原因)。**不允许回到可编辑态**(规则 5)
  APPROVED: [
    { to: "EXPORTED", roles: ["PROCUREMENT"] },
    { to: "CANCELLED", roles: ["MANAGEMENT"], requiresReason: true },
  ],
  EXPORTED: [],
  // 退回后可回草稿继续修改(改动在同一单据上,因为 PO 尚未生效;
  // 与报价不同 —— 报价已批准版本必须开新 Revision,PO 是被退回、从未生效)
  REJECTED: [
    { to: "DRAFT", roles: ["PROCUREMENT"] },
    { to: "CANCELLED", roles: ["PROCUREMENT"], requiresReason: true },
  ],
  CANCELLED: [],
};

export interface PoLineFlagState {
  lineNo: number;
  /** 该行是否有未处理的价格/交期异常(见 po-price-review.ts) */
  hasUnresolvedFlag: boolean;
}

export type PoTransitionResult =
  | { ok: true }
  | { ok: false; code: "not_allowed"; message: string }
  | { ok: false; code: "forbidden_role"; message: string }
  | { ok: false; code: "reason_required"; message: string }
  | { ok: false; code: "no_lines"; message: string }
  | { ok: false; code: "flags_unresolved"; message: string; unresolvedLines: number[] };

export interface PoTransitionInput {
  from: PoStatusValue;
  to: PoStatusValue;
  roles: RoleName[];
  reason?: string | null;
  /** 提交复核时必须给出全部行的异常处理状态(规则 2) */
  lines?: readonly PoLineFlagState[];
}

export function checkPoTransition(input: PoTransitionInput): PoTransitionResult {
  const { from, to, roles, reason, lines } = input;

  const rule = (PO_TRANSITIONS[from] ?? []).find((r) => r.to === to);
  if (!rule) {
    return {
      ok: false,
      code: "not_allowed",
      message: `不允许从 ${PO_STATUS_LABELS[from]} 流转到 ${PO_STATUS_LABELS[to]}`,
    };
  }

  // MANAGEMENT 可执行任何被允许的流转(与报价状态机一致)
  const permitted = roles.includes("MANAGEMENT") || rule.roles.some((r) => roles.includes(r));
  if (!permitted) {
    return {
      ok: false,
      code: "forbidden_role",
      message: `当前角色无权执行「${PO_STATUS_LABELS[from]} → ${PO_STATUS_LABELS[to]}」`,
    };
  }

  if (rule.requiresReason && !reason?.trim()) {
    return {
      ok: false,
      code: "reason_required",
      message: `流转到 ${PO_STATUS_LABELS[to]} 必须填写原因`,
    };
  }

  if (rule.requiresFlagsResolved) {
    if (!lines || lines.length === 0) {
      return { ok: false, code: "no_lines", message: "空订单不得提交" };
    }
    const unresolved = lines.filter((l) => l.hasUnresolvedFlag).map((l) => l.lineNo);
    if (unresolved.length > 0) {
      return {
        ok: false,
        code: "flags_unresolved",
        message: `第 ${unresolved.join("、")} 行存在未处理的价格/交期异常,逐项处理后方可提交复核`,
        unresolvedLines: unresolved,
      };
    }
  }

  return { ok: true };
}
