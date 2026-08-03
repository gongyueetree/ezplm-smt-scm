/**
 * 物料生命周期状态机与使用约束(纯函数)。
 *
 * 核心约束:**草稿不得进入正式 BOM**。
 * 草稿是"还没填完、还没人审"的半成品;让它进 BOM 意味着报价、采购、追溯
 * 全都建立在一份没人负责的数据上,而且往往要到出货后才被发现。
 *
 * 纪律:
 * - 状态流转显式列举,**禁止任意跳转**;
 * - `DISABLED`(暂时停用)与 `OBSOLETE`(永久淘汰)语义不同,对 BOM 的约束也不同;
 * - 已在 BOM 中使用的物料**不能直接淘汰**,必须先处理引用 ——
 *   否则历史 BOM 会指向一个"不存在"的料。
 */

export type PartStatusValue =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "ACTIVE"
  | "REJECTED"
  | "DISABLED"
  | "OBSOLETE";

export const PART_STATUS_LABEL: Record<PartStatusValue, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审核",
  ACTIVE: "已启用",
  REJECTED: "已退回",
  DISABLED: "已停用",
  OBSOLETE: "已淘汰",
};

/** 允许的流转 */
const TRANSITIONS: Record<PartStatusValue, PartStatusValue[]> = {
  DRAFT: ["PENDING_REVIEW", "ACTIVE"],
  PENDING_REVIEW: ["ACTIVE", "REJECTED"],
  REJECTED: ["DRAFT", "PENDING_REVIEW"],
  ACTIVE: ["DISABLED", "OBSOLETE"],
  // 停用是可逆的;淘汰不是
  DISABLED: ["ACTIVE", "OBSOLETE"],
  OBSOLETE: [],
};

export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: string; message: string };

export interface TransitionInput {
  from: PartStatusValue;
  to: PartStatusValue;
  /** 退回与淘汰必须写原因 */
  reason?: string | null;
  /** 该物料当前被多少个 BOM 版本引用 */
  bomUsageCount?: number;
  /** 直接从草稿转 ACTIVE 需要有 material.review 权限(跳过审核) */
  canSkipReview?: boolean;
}

export function checkPartTransition(input: TransitionInput): TransitionCheck {
  const { from, to } = input;

  if (from === to) {
    return { ok: false, code: "same_status", message: `物料已处于「${PART_STATUS_LABEL[to]}」` };
  }
  if (!TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      code: "invalid_transition",
      message:
        from === "OBSOLETE"
          ? "已淘汰是终态,不可再流转 —— 如需恢复请新建物料并建立替代关系"
          : `不允许从「${PART_STATUS_LABEL[from]}」直接到「${PART_STATUS_LABEL[to]}」`,
    };
  }

  // 草稿直接启用 = 跳过审核,需要额外权限
  if (from === "DRAFT" && to === "ACTIVE" && !input.canSkipReview) {
    return {
      ok: false,
      code: "review_required",
      message: "草稿直接启用等于跳过审核,需要 material.review 权限;否则请先提交审核",
    };
  }

  if ((to === "REJECTED" || to === "OBSOLETE") && !input.reason?.trim()) {
    return {
      ok: false,
      code: "reason_required",
      message: `「${PART_STATUS_LABEL[to]}」必须填写原因`,
    };
  }

  // 仍被 BOM 引用的物料不得淘汰 —— 否则历史 BOM 会指向不存在的料
  if (to === "OBSOLETE" && (input.bomUsageCount ?? 0) > 0) {
    return {
      ok: false,
      code: "still_referenced",
      message: `该物料仍被 ${input.bomUsageCount} 个 BOM 版本引用,不能淘汰 —— 请先在这些 BOM 中替换或标注替代料`,
    };
  }

  return { ok: true };
}

/** 可用于正式 BOM 的状态 —— **只有 ACTIVE** */
export function canUseInBom(status: PartStatusValue): boolean {
  return status === "ACTIVE";
}

export interface BomUsageCheck {
  allowed: boolean;
  reason: string | null;
}

/**
 * 能否把某物料放进正式 BOM。
 *
 * 每种被拒状态给**不同的**说明 —— 用一句"状态不允许"打发,
 * 使用者不知道该去催审核、还是该换料。
 */
export function checkBomUsage(status: PartStatusValue): BomUsageCheck {
  switch (status) {
    case "ACTIVE":
      return { allowed: true, reason: null };
    case "DRAFT":
      return {
        allowed: false,
        reason: "草稿物料**不得进入正式 BOM** —— 请先补齐信息并提交审核",
      };
    case "PENDING_REVIEW":
      return { allowed: false, reason: "该物料正在审核中,审核通过后方可用于 BOM" };
    case "REJECTED":
      return { allowed: false, reason: "该物料审核被退回,请先处理退回意见" };
    case "DISABLED":
      return { allowed: false, reason: "该物料已停用;如确需使用请先恢复启用" };
    case "OBSOLETE":
      return { allowed: false, reason: "该物料已淘汰,请改用替代料" };
  }
}
