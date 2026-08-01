/**
 * ERP 同步的重试与终态判定(纯函数)。
 *
 * 为什么需要:原实现只有成功/失败两态。真实 ERP 同步里最常见的情形是
 * **一批 200 行里 3 行失败** —— 标成 FAILED 会让人以为整批没进去,
 * 重跑又会把已成功的 197 行再写一遍。
 *
 * 纪律:
 * - **PARTIAL_SUCCESS 是独立终态**,不是 FAILED 的变体;
 * - 重试**只针对失败行**,成功行不重复同步(靠 resumeFromLineNo + 行级 outcome);
 * - 退避默认指数:外部系统正在故障时,固定间隔重试等于加剧其压力;
 * - 次数耗尽转 **DEAD_LETTER 并停止自动重试** —— 无限重试会把配额打光
 *   (真实教训:DigiKey 日配额 1000 次被 E2E 打光过);
 * - **冲突不算失败**:冲突是等人决策,重试解决不了,不进重试计数。
 */

export type JobStatusValue =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "PARTIAL_SUCCESS"
  | "RETRYING"
  | "DEAD_LETTER";

export type BackoffStrategy = "FIXED" | "EXPONENTIAL" | "NONE";

/** 终态:不会再自动流转 */
export const TERMINAL_STATUSES: readonly JobStatusValue[] = [
  "SUCCEEDED",
  "PARTIAL_SUCCESS",
  "CANCELLED",
  "DEAD_LETTER",
];

export function isTerminal(status: JobStatusValue): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface LineCounts {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  conflict: number;
  failed: number;
}

/**
 * 由行级结果推导作业状态。
 *
 * 这是整个模块最容易做错的地方,四条判定顺序不能乱:
 * ① 一行都没有 → SUCCEEDED(空批次是成功,不是失败);
 * ② 有失败 且 有成功 → **PARTIAL_SUCCESS**;
 * ③ 全失败 → FAILED;
 * ④ 无失败 → SUCCEEDED(**冲突不算失败** —— 冲突是等人决策)。
 */
export function deriveJobStatus(counts: LineCounts): JobStatusValue {
  const succeeded = counts.created + counts.updated + counts.unchanged;
  const total = succeeded + counts.skipped + counts.conflict + counts.failed;

  if (total === 0) return "SUCCEEDED";
  if (counts.failed === 0) return "SUCCEEDED";
  // 有失败:看是否还有成功的行
  if (succeeded > 0 || counts.conflict > 0 || counts.skipped > 0) return "PARTIAL_SUCCESS";
  return "FAILED";
}

export interface RetryDecision {
  shouldRetry: boolean;
  nextStatus: JobStatusValue;
  /** 距下次可重试的毫秒数;不重试时为 null */
  delayMs: number | null;
  reason: string;
}

/** 指数退避的基准间隔(毫秒):30s → 2min → 8min → 32min */
export const BASE_DELAY_MS = 30_000;

export function computeBackoffMs(
  strategy: BackoffStrategy,
  retryCount: number,
  baseMs = BASE_DELAY_MS,
): number | null {
  if (strategy === "NONE") return null;
  if (strategy === "FIXED") return baseMs;
  // 指数:base * 4^n,并设 1 小时上限,避免退避到天级别
  const raw = baseMs * Math.pow(4, Math.max(0, retryCount));
  return Math.min(raw, 3_600_000);
}

export interface RetryInput {
  status: JobStatusValue;
  retryCount: number;
  maxRetries: number;
  backoffStrategy: BackoffStrategy;
  counts: LineCounts;
  /** 人工触发的重试不受 nextRetryAt 与次数限制(人比调度器更清楚现在能不能重试) */
  manual?: boolean;
}

/**
 * 是否重试、重试后的状态与延迟。
 */
export function decideRetry(input: RetryInput): RetryDecision {
  const { status, retryCount, maxRetries, backoffStrategy, counts } = input;

  if (status === "CANCELLED") {
    return { shouldRetry: false, nextStatus: "CANCELLED", delayMs: null, reason: "作业已取消" };
  }
  if (status === "SUCCEEDED") {
    return { shouldRetry: false, nextStatus: "SUCCEEDED", delayMs: null, reason: "全部成功,无需重试" };
  }
  if (counts.failed === 0) {
    return {
      shouldRetry: false,
      nextStatus: status,
      delayMs: null,
      reason: "没有失败行 —— 冲突需人工决策,重试解决不了",
    };
  }
  if (backoffStrategy === "NONE" && !input.manual) {
    return {
      shouldRetry: false,
      nextStatus: "DEAD_LETTER",
      delayMs: null,
      reason: "该作业配置为不自动重试(backoff=NONE),转人工处理",
    };
  }
  if (retryCount >= maxRetries && !input.manual) {
    return {
      shouldRetry: false,
      nextStatus: "DEAD_LETTER",
      delayMs: null,
      reason: `已重试 ${retryCount} 次达上限 ${maxRetries},转人工 —— 继续自动重试会打光外部配额`,
    };
  }

  const delayMs = input.manual ? 0 : (computeBackoffMs(backoffStrategy, retryCount) ?? 0);
  return {
    shouldRetry: true,
    nextStatus: "RETRYING",
    delayMs,
    reason: input.manual
      ? "人工触发重试,立即执行"
      : `第 ${retryCount + 1} 次重试,${Math.round(delayMs / 1000)} 秒后执行(仅重试失败行)`,
  };
}

/** 到点了吗 —— 调度器用它挑作业 */
export function isRetryDue(nextRetryAt: string | null, now: string): boolean {
  if (!nextRetryAt) return false;
  const a = Date.parse(nextRetryAt);
  const b = Date.parse(now);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a <= b;
}

/**
 * 重跑时应从哪一行继续。
 *
 * **已成功的行不重复同步**:取最大的"已成功行号 + 1"。
 * 失败行分散在中间时,仍从最早的失败行开始 —— 保证不漏。
 */
export function resumePoint(
  lines: readonly { lineNo: number; outcome: string }[],
): { fromLineNo: number; retryLineNos: number[]; skipCount: number } {
  const failed = lines.filter((l) => l.outcome === "FAILED").map((l) => l.lineNo).sort((a, b) => a - b);
  if (failed.length === 0) {
    const max = lines.reduce((m, l) => Math.max(m, l.lineNo), 0);
    return { fromLineNo: max + 1, retryLineNos: [], skipCount: lines.length };
  }
  return {
    fromLineNo: failed[0],
    retryLineNos: failed,
    // 跳过的是"行号小于首个失败行且已成功"的部分
    skipCount: lines.filter((l) => l.lineNo < failed[0] && l.outcome !== "FAILED").length,
  };
}

/** ERP 回执状态 —— 五种,不得压成一个"成功" */
export const ERP_RECEIPT_STATES = [
  "TEMPLATE_GENERATED",
  "SENT",
  "ERP_RECEIVED",
  "ERP_POSTED",
  "ERP_FAILED",
] as const;

export type ErpReceiptState = (typeof ERP_RECEIPT_STATES)[number];

export const ERP_RECEIPT_LABEL: Record<ErpReceiptState, string> = {
  TEMPLATE_GENERATED: "已生成模板",
  SENT: "已发送",
  ERP_RECEIVED: "ERP 已接收",
  ERP_POSTED: "ERP 已建单",
  ERP_FAILED: "ERP 拒绝",
};

/**
 * 回执状态是否代表"ERP 里真的有单据了"。
 *
 * 只有 ERP_POSTED 算。**已发送 / 已接收都不算** ——
 * 接收只代表报文收到了,ERP 可能后续校验失败。
 */
export function isPostedInErp(state: ErpReceiptState | null | undefined): boolean {
  return state === "ERP_POSTED";
}
