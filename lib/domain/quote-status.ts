/**
 * 报价状态机与快照冻结(SPEC §12 + CLAUDE.md 领域规则)。
 *
 * 六条规则,逐条以纯函数固化:
 * 1. DRAFT → PENDING_APPROVAL → APPROVED / REJECTED / EXPIRED;
 * 2. **分类未全部人工确认不得提交**;
 * 3. 提交存 submittedSnapshot,通过存 approvedSnapshot;
 * 4. **PENDING / APPROVED 下参数全冻结**(任何改参数的操作都必须被拒);
 * 5. PDF / 正式导出**只用快照**,不得用实时数据重算;
 * 6. 退回记原因,改动走**新 Revision**,**禁止覆盖已批准版本**。
 */
import type { RoleName } from "@/lib/routes";
import type { QuoteSummary } from "./quote-calc";

export const QUOTE_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
] as const;

export type QuoteStatusValue = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatusValue, string> = {
  DRAFT: "草稿",
  PENDING_APPROVAL: "待审批",
  APPROVED: "已批准",
  REJECTED: "已退回",
  EXPIRED: "已过期",
};

/** 参数冻结的状态:这些状态下任何参数修改都必须被拒(规则 4) */
export const FROZEN_STATUSES: readonly QuoteStatusValue[] = ["PENDING_APPROVAL", "APPROVED"];

/** 终态:不可再流转(REJECTED 可开新 Revision,但当前版本本身到此为止) */
export const TERMINAL_QUOTE_STATUSES: readonly QuoteStatusValue[] = [
  "APPROVED",
  "REJECTED",
  "EXPIRED",
];

export function isFrozen(status: QuoteStatusValue): boolean {
  return FROZEN_STATUSES.includes(status);
}

export function isTerminalQuoteStatus(status: QuoteStatusValue): boolean {
  return TERMINAL_QUOTE_STATUSES.includes(status);
}

interface QuoteTransitionRule {
  to: QuoteStatusValue;
  roles: RoleName[];
  requiresReason?: boolean;
}

const QUOTE_TRANSITIONS: Record<QuoteStatusValue, QuoteTransitionRule[]> = {
  DRAFT: [{ to: "PENDING_APPROVAL", roles: ["PM"] }],
  PENDING_APPROVAL: [
    { to: "APPROVED", roles: ["MANAGEMENT"] },
    // 退回必须记原因(规则 6)
    { to: "REJECTED", roles: ["MANAGEMENT"], requiresReason: true },
    { to: "EXPIRED", roles: ["MANAGEMENT"] },
  ],
  APPROVED: [{ to: "EXPIRED", roles: ["MANAGEMENT"] }],
  REJECTED: [],
  EXPIRED: [],
};

export interface QuoteLineConfirmation {
  lineNo: number;
  /** 该行的物料分类是否已人工确认(规则 2) */
  categoryConfirmed: boolean;
}

export type QuoteTransitionRejection =
  | { ok: false; code: "not_allowed"; message: string }
  | { ok: false; code: "forbidden_role"; message: string }
  | { ok: false; code: "reason_required"; message: string }
  | { ok: false; code: "categories_unconfirmed"; message: string; unconfirmedLines: number[] }
  | { ok: false; code: "no_lines"; message: string };

export type QuoteTransitionResult = { ok: true } | QuoteTransitionRejection;

export interface QuoteTransitionInput {
  from: QuoteStatusValue;
  to: QuoteStatusValue;
  roles: RoleName[];
  reason?: string | null;
  /** 提交审批时必须给出全部行的分类确认状态(规则 2) */
  lines?: readonly QuoteLineConfirmation[];
}

export function checkQuoteTransition(input: QuoteTransitionInput): QuoteTransitionResult {
  const { from, to, roles, reason, lines } = input;

  const rule = (QUOTE_TRANSITIONS[from] ?? []).find((r) => r.to === to);
  if (!rule) {
    return {
      ok: false,
      code: "not_allowed",
      message: `不允许从 ${QUOTE_STATUS_LABELS[from]} 流转到 ${QUOTE_STATUS_LABELS[to]}`,
    };
  }

  const permitted = roles.includes("MANAGEMENT") || rule.roles.some((r) => roles.includes(r));
  if (!permitted) {
    return {
      ok: false,
      code: "forbidden_role",
      message: `当前角色无权执行「${QUOTE_STATUS_LABELS[from]} → ${QUOTE_STATUS_LABELS[to]}」`,
    };
  }

  if (rule.requiresReason && !reason?.trim()) {
    return {
      ok: false,
      code: "reason_required",
      message: `流转到 ${QUOTE_STATUS_LABELS[to]} 必须填写原因`,
    };
  }

  // 规则 2:提交审批前,分类必须全部人工确认
  if (to === "PENDING_APPROVAL") {
    const list = lines ?? [];
    if (list.length === 0) {
      return { ok: false, code: "no_lines", message: "报价没有任何行,不能提交审批" };
    }
    const unconfirmed = list.filter((l) => !l.categoryConfirmed).map((l) => l.lineNo);
    if (unconfirmed.length > 0) {
      return {
        ok: false,
        code: "categories_unconfirmed",
        message: `还有 ${unconfirmed.length} 行的物料分类未人工确认,不能提交审批`,
        unconfirmedLines: unconfirmed,
      };
    }
  }

  return { ok: true };
}

export function availableQuoteTransitions(
  from: QuoteStatusValue,
  roles: RoleName[],
): { to: QuoteStatusValue; label: string; requiresReason: boolean }[] {
  return (QUOTE_TRANSITIONS[from] ?? [])
    .filter((r) => roles.includes("MANAGEMENT") || r.roles.some((x) => roles.includes(x)))
    .map((r) => ({ to: r.to, label: QUOTE_STATUS_LABELS[r.to], requiresReason: !!r.requiresReason }));
}

// ============================================================
// 参数冻结守卫(规则 4)
// ============================================================

export type MutationKind =
  | "edit_line"
  | "add_line"
  | "delete_line"
  | "edit_labor_template"
  | "edit_overhead";

/**
 * 参数修改守卫:PENDING_APPROVAL / APPROVED 下一律拒绝。
 * 这是"审批后改折扣被拒"那条 jsdom 断言的领域层来源。
 */
export function checkParameterMutation(
  status: QuoteStatusValue,
  kind: MutationKind,
): { ok: boolean; message?: string } {
  if (isFrozen(status)) {
    return {
      ok: false,
      message: `报价处于「${QUOTE_STATUS_LABELS[status]}」,参数已冻结,不能执行「${kind}」;如需改动请新建 Revision`,
    };
  }
  if (status === "REJECTED" || status === "EXPIRED") {
    return {
      ok: false,
      message: `报价处于「${QUOTE_STATUS_LABELS[status]}」,请新建 Revision 后修改`,
    };
  }
  return { ok: true };
}

// ============================================================
// 快照(规则 3、5)
// ============================================================

/**
 * 正式报价单的表头信息(客户 docx:「PDF 报价单目前是 copy 的系统界面,没有按照固定模式生成」)。
 * 必须随快照冻结 —— 正式文件只用快照,提交后改客户名或有效期不得影响已冻结的单据。
 * 可选:旧快照没有这一段,渲染时如实标注"该快照未包含此信息"而不是补一个当前值。
 */
export interface QuoteDocHeader {
  customerName: string | null;
  customerCode: string | null;
  /** 报价有效期(ISO 日期);未设置时为 null */
  validUntil: string | null;
  /** 报价方主体 */
  sellerName: string;
}

/**
 * 正式报价单明细行的**描述性字段**(MPN/制造商/物料类别/替代料)。
 * 与 QuoteSummary 分开存:后者是纯计算结果、单测覆盖密集,不往里塞展示字段。
 * 按 lineNo 与 summary.lines 对齐。
 */
export interface QuoteDocLine {
  lineNo: number;
  quotedMfg: string | null;
  quotedMpn: string | null;
  materialCategory: string | null;
  altMfg: string | null;
  altMpn: string | null;
  note: string | null;
}

export interface QuoteSnapshot {
  /** 快照生成时点 */
  frozenAt: string;
  quoteCode: string;
  revision: number;
  status: QuoteStatusValue;
  currency: string;
  summary: QuoteSummary;
  laborTemplate: unknown;
  /** 生成快照的人 */
  frozenById: string;
  /** 正式报价单表头;旧快照可能没有 */
  doc?: QuoteDocHeader;
  /** 正式报价单明细的描述性字段;旧快照可能没有 */
  docLines?: QuoteDocLine[];
}

export interface BuildSnapshotInput {
  quoteCode: string;
  revision: number;
  status: QuoteStatusValue;
  currency: string;
  summary: QuoteSummary;
  laborTemplate: unknown;
  frozenById: string;
  frozenAt: string;
  doc?: QuoteDocHeader;
  docLines?: QuoteDocLine[];
}

/** 构建冻结快照(整单文档,逐字节固化) */
export function buildQuoteSnapshot(input: BuildSnapshotInput): QuoteSnapshot {
  return {
    frozenAt: input.frozenAt,
    quoteCode: input.quoteCode,
    revision: input.revision,
    status: input.status,
    currency: input.currency,
    summary: input.summary,
    laborTemplate: input.laborTemplate,
    frozenById: input.frozenById,
    ...(input.doc ? { doc: input.doc } : {}),
    ...(input.docLines ? { docLines: input.docLines } : {}),
  };
}

export type ExportSource =
  | { ok: true; snapshot: QuoteSnapshot; kind: "approved" | "submitted" }
  | { ok: false; message: string };

/**
 * 正式导出(PDF/XLSX)的数据来源(规则 5)。
 * **只认快照**:已批准取 approvedSnapshot,待审批取 submittedSnapshot;
 * 两者都没有就拒绝导出 —— 绝不用实时数据重算充当正式文件。
 */
export function resolveExportSource(input: {
  status: QuoteStatusValue;
  approvedSnapshot?: QuoteSnapshot | null;
  submittedSnapshot?: QuoteSnapshot | null;
}): ExportSource {
  if (input.status === "APPROVED") {
    if (!input.approvedSnapshot) {
      return { ok: false, message: "已批准报价缺少审批快照,不能导出正式文件" };
    }
    return { ok: true, snapshot: input.approvedSnapshot, kind: "approved" };
  }
  if (input.status === "PENDING_APPROVAL") {
    if (!input.submittedSnapshot) {
      return { ok: false, message: "待审批报价缺少提交快照,不能导出" };
    }
    return { ok: true, snapshot: input.submittedSnapshot, kind: "submitted" };
  }
  return {
    ok: false,
    message: `「${QUOTE_STATUS_LABELS[input.status]}」状态没有可用快照,正式导出只能基于已提交或已批准的快照`,
  };
}

// ============================================================
// 修订版(规则 6)
// ============================================================

export interface RevisionRef {
  revision: number;
  status: QuoteStatusValue;
}

/**
 * 新建修订版校验:必须在**最大修订号 + 1** 上新增,禁止覆盖任何既有版本,
 * 尤其禁止覆盖已批准版本。
 */
export function planNextRevision(existing: readonly RevisionRef[]): {
  nextRevision: number;
  /** 已批准的版本号(存在即说明历史必须保留) */
  approvedRevisions: number[];
} {
  const max = existing.reduce((m, r) => Math.max(m, r.revision), 0);
  return {
    nextRevision: max + 1,
    approvedRevisions: existing.filter((r) => r.status === "APPROVED").map((r) => r.revision),
  };
}

/** 写入守卫:任何试图写入"已存在修订号"的操作都必须被拒(禁止覆盖) */
export function checkRevisionWrite(
  targetRevision: number,
  existing: readonly RevisionRef[],
): { ok: boolean; message?: string } {
  const hit = existing.find((r) => r.revision === targetRevision);
  if (!hit) return { ok: true };
  return {
    ok: false,
    message:
      hit.status === "APPROVED"
        ? `Revision ${targetRevision} 已批准,禁止覆盖;请使用 Revision ${planNextRevision(existing).nextRevision}`
        : `Revision ${targetRevision} 已存在,禁止覆盖;请使用 Revision ${planNextRevision(existing).nextRevision}`,
  };
}
