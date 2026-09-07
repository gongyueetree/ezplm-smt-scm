/**
 * F4:实体级同步状态机(纯函数)。
 *
 * 三条设计底线:
 *
 * 1. **幂等键首次生成后永不改变。** ERP Lab 的 NETWORK_DROP_AFTER_COMMIT 场景
 *    (PO 已写入 ERP、响应没回来)是所有 ERP 集成里最危险的一类失败:
 *    重试若换了键,ERP 里就是两张单。所以键从业务身份推导(`buildIntegrationKey`),
 *    不含时间戳、不含随机数、不含尝试次数。
 *
 * 2. **BLOCKED ≠ FAILED ≠ RETRY_REQUIRED。**
 *    - RETRY_REQUIRED:瞬态(限流/超时/500/断网),同样的请求过会儿再发可能就成了;
 *    - BLOCKED:重试**注定无效**(凭据过期、ERP 里已有同号单据),必须先人工处置;
 *    - FAILED:数据本身有问题(物料/供应商在 ERP 不存在),修完数据后可人工重试。
 *    把三者压成一个"失败"会让人对着限流狂点重试、对着过期凭据傻等退避。
 *
 * 3. **NOT_CONFIGURED 是一等状态。** 租户没配 ERP 时,一切同步位都停在这里 ——
 *    不是 0 条成功,不是失败,页面必须显示「ERP 未配置」并给出 Excel 兜底入口。
 */

export type IntegrationSyncState =
  | "NOT_CONFIGURED"
  | "READY"
  | "PENDING"
  | "SYNCING"
  | "SYNCED"
  | "FAILED"
  | "RETRY_REQUIRED"
  | "BLOCKED";

export const SYNC_STATE_LABEL: Record<IntegrationSyncState, string> = {
  NOT_CONFIGURED: "ERP 未配置",
  READY: "就绪(未同步)",
  PENDING: "已排队",
  SYNCING: "同步中",
  SYNCED: "已同步",
  FAILED: "失败(需修数据后重试)",
  RETRY_REQUIRED: "待重试(瞬态失败)",
  BLOCKED: "已阻断(需人工处置)",
};

/**
 * 允许的状态转移。
 *
 * 关键约束:
 * - SYNCING 只能从 PENDING / RETRY_REQUIRED / FAILED / BLOCKED(人工重试)进入;
 * - SYNCED 只能从 SYNCING 进入 —— 没有任何路径可以"直接标成功";
 * - NOT_CONFIGURED 可从任何状态进入(租户把 ERP 关了),反向只能到 READY(重新配置)。
 */
const TRANSITIONS: Record<IntegrationSyncState, readonly IntegrationSyncState[]> = {
  NOT_CONFIGURED: ["READY"],
  READY: ["PENDING", "NOT_CONFIGURED"],
  PENDING: ["SYNCING", "NOT_CONFIGURED"],
  SYNCING: ["SYNCED", "FAILED", "RETRY_REQUIRED", "BLOCKED"],
  SYNCED: ["PENDING", "NOT_CONFIGURED"],
  FAILED: ["SYNCING", "PENDING", "NOT_CONFIGURED"],
  RETRY_REQUIRED: ["SYNCING", "PENDING", "NOT_CONFIGURED"],
  BLOCKED: ["SYNCING", "PENDING", "NOT_CONFIGURED"],
};

export function canTransition(from: IntegrationSyncState, to: IntegrationSyncState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** 可发起(自动或人工)同步尝试的状态 */
export function canAttempt(state: IntegrationSyncState): boolean {
  return state === "PENDING" || state === "RETRY_REQUIRED" || state === "FAILED" || state === "BLOCKED";
}

/** 人工重试按钮该不该亮:BLOCKED 也允许(人工处置完 ERP 侧后由人确认重试) */
export function canManualRetry(state: IntegrationSyncState): boolean {
  return state === "RETRY_REQUIRED" || state === "FAILED" || state === "BLOCKED";
}

// ============================================================
// 失败分类:ERP Lab 13 场景 → 终态矩阵
// ============================================================

export interface ErpFailure {
  /** Provider 抛出的错误码(ERP Lab 的 code 或本地网络错误) */
  code: string;
  /** Provider 声明是否可重试;未知按不可重试处理(保守) */
  retryable: boolean;
  httpStatus?: number;
  message?: string;
}

export interface FailureClassification {
  state: Extract<IntegrationSyncState, "FAILED" | "RETRY_REQUIRED" | "BLOCKED">;
  /** 是否必须**复用原幂等键**重试(提交后断网场景恒为 true) */
  mustReuseIdempotencyKey: boolean;
  /** 给人看的处置建议 */
  advice: string;
}

/**
 * 错误码 → 终态。
 *
 * 与 ERP Lab 场景矩阵一一对应(`tests/unit/integration-sync.test.ts` 锁死):
 * - 凭据类(AUTH_EXPIRED / UNAUTHORIZED)→ BLOCKED:重试打不破 401,先换凭据;
 * - 单据冲突(PO_ALREADY_EXISTS)→ BLOCKED:ERP 里已有单,自动重试等于再撞一次,
 *   要人工核对 ERP 单号后决定「登记既有单号」还是「作废重来」;
 * - 主数据缺失(MATERIAL/SUPPLIER_NOT_FOUND)→ FAILED:修完数据人工重试;
 * - 瞬态(TIMEOUT / RATE_LIMIT / ERP_500 / 断网)→ RETRY_REQUIRED。
 *
 * 未知错误码按 `retryable` 位走,**不猜语义**:可重试→RETRY_REQUIRED,否则→FAILED。
 */
const BLOCKED_CODES = new Set([
  "ERP_AUTH_EXPIRED",
  "ERP_LAB_UNAUTHORIZED",
  "ERP_LAB_ACCESS_TOKEN_NOT_CONFIGURED",
  "PO_ALREADY_EXISTS",
]);

const DATA_FIX_CODES = new Set([
  "MATERIAL_NOT_FOUND",
  "SUPPLIER_NOT_FOUND",
  "PO_NOT_FOUND",
  "PO_LINE_NOT_FOUND",
  "BROKEN_REFERENCE",
  "VALIDATION_ERROR",
  "INVALID_DECIMAL",
  "IDEMPOTENCY_KEY_REQUIRED",
]);

export function classifyErpFailure(failure: ErpFailure): FailureClassification {
  if (failure.code === "NETWORK_DROP_AFTER_COMMIT") {
    return {
      state: "RETRY_REQUIRED",
      mustReuseIdempotencyKey: true,
      advice: "ERP 可能已建单但响应丢失 —— 必须用原幂等键重试,ERP 会返回首次创建的单据而不是重复建单",
    };
  }
  if (BLOCKED_CODES.has(failure.code)) {
    return {
      state: "BLOCKED",
      mustReuseIdempotencyKey: true,
      advice:
        failure.code === "PO_ALREADY_EXISTS"
          ? "ERP 中已存在同号单据 —— 请人工核对 ERP 单号后处置,自动重试只会再次冲突"
          : "凭据无效或过期 —— 请先在集成设置中更新凭据,重试不会自行恢复",
    };
  }
  if (DATA_FIX_CODES.has(failure.code)) {
    return {
      state: "FAILED",
      mustReuseIdempotencyKey: true,
      advice: "数据校验未通过(主数据缺失或字段非法)—— 修正数据后人工重试",
    };
  }
  if (failure.retryable) {
    return {
      state: "RETRY_REQUIRED",
      mustReuseIdempotencyKey: true,
      advice: "瞬态失败(超时/限流/服务端错误)—— 按退避策略重试",
    };
  }
  return {
    state: "FAILED",
    mustReuseIdempotencyKey: true,
    advice: "不可重试的错误 —— 请查看错误信息并人工处置",
  };
}

// ============================================================
// 幂等键
// ============================================================

/**
 * 集成幂等键:**从业务身份推导,稳定可再生**。
 *
 * 同一对象无论重试多少次、从哪台机器发起,键都一样 ——
 * 这是「提交后断网 → 重试拿回原单」成立的前提。
 * 禁止混入时间戳/随机数/attempt 计数。
 */
export function buildIntegrationKey(input: {
  tenantId: string;
  entityType: string;
  entityId: string;
}): string {
  return `${input.tenantId}:${input.entityType}:${input.entityId}`;
}

// ============================================================
// 尝试结果 → 记录字段(供 repository 落库;此处只算不写)
// ============================================================

export interface AttemptOutcomePatch {
  state: IntegrationSyncState;
  errorCode: string | null;
  errorMessage: string | null;
  externalId?: string | null;
  externalDocumentNo?: string | null;
  note?: string | null;
}

export function applySuccess(result: {
  externalId?: string | null;
  documentNumber?: string | null;
  idempotentReplay?: boolean;
}): AttemptOutcomePatch {
  return {
    state: "SYNCED",
    errorCode: null,
    errorMessage: null,
    externalId: result.externalId ?? null,
    externalDocumentNo: result.documentNumber ?? null,
    note: result.idempotentReplay
      ? "幂等重放:ERP 返回首次创建的单据(此前的提交已生效,未重复建单)"
      : null,
  };
}

export function applyFailure(failure: ErpFailure): AttemptOutcomePatch {
  const cls = classifyErpFailure(failure);
  return {
    state: cls.state,
    errorCode: failure.code,
    errorMessage: `${failure.message ?? failure.code} —— ${cls.advice}`,
  };
}
