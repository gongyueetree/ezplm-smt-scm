/**
 * 运维指标(纯函数)。
 *
 * 原实现只有"最近一次结果":看不出趋势,也回答不了运维真正要问的问题 ——
 * "最近一周同步成功率多少?平均要重试几次?哪个连接在拖后腿?"
 *
 * 纪律:
 * - **样本为 0 时返回 null,不返回 0**。0% 成功率与"这周没跑过"是两回事,
 *   前者要立刻处理,后者只是没数据;
 * - 百分比只在**有分母**时给;分母为 0 一律 null;
 * - 指标只描述事实,**不下"健康/不健康"的结论** —— 判定在 erp-health.ts,
 *   两者分开,免得一个数字既当指标又当结论。
 */

export interface JobSample {
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  retryCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  conflictCount: number;
  failedCount: number;
}

export interface JobMetrics {
  total: number;
  byStatus: Record<string, number>;
  /** 成功率(SUCCEEDED / 有结论的作业);无样本时 null */
  successRate: number | null;
  /** 部分成功率 —— 单独暴露,它常被误并入"成功" */
  partialRate: number | null;
  /** 平均耗时(毫秒);无可计算样本时 null */
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  /** 平均重试次数;无样本时 null */
  avgRetries: number | null;
  /** 行级汇总 */
  lines: {
    total: number;
    failed: number;
    conflict: number;
    /** 行级失败率;无行时 null */
    failureRate: number | null;
  };
  /** 需人工处理的作业数(DEAD_LETTER) */
  deadLetters: number;
}

function durationMs(j: JobSample): number | null {
  if (!j.startedAt || !j.finishedAt) return null;
  const a = Date.parse(j.startedAt);
  const b = Date.parse(j.finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

/**
 * 分位数,**最近秩法**(nearest-rank)。
 *
 * 不用 `floor((n-1)*p)`:小样本时它会低估尾部
 * (两个样本 [1s, 9s] 的 P95 会算成 1s)。
 * P95 的用途正是发现慢作业,**低估是危险方向** —— 会把问题藏起来。
 */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function computeJobMetrics(jobs: readonly JobSample[]): JobMetrics {
  const byStatus: Record<string, number> = {};
  for (const j of jobs) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;

  // 只有"已出结论"的作业才参与成功率:运行中/待重试的还没结果
  const concluded = jobs.filter((j) =>
    ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "DEAD_LETTER", "CANCELLED"].includes(j.status),
  );

  const durations = jobs
    .map(durationMs)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);

  const lineTotal = jobs.reduce(
    (a, j) =>
      a + j.createdCount + j.updatedCount + j.unchangedCount + j.skippedCount + j.conflictCount + j.failedCount,
    0,
  );
  const lineFailed = jobs.reduce((a, j) => a + j.failedCount, 0);
  const lineConflict = jobs.reduce((a, j) => a + j.conflictCount, 0);

  return {
    total: jobs.length,
    byStatus,
    successRate:
      concluded.length === 0
        ? null
        : concluded.filter((j) => j.status === "SUCCEEDED").length / concluded.length,
    partialRate:
      concluded.length === 0
        ? null
        : concluded.filter((j) => j.status === "PARTIAL_SUCCESS").length / concluded.length,
    avgDurationMs:
      durations.length === 0
        ? null
        : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    p95DurationMs: percentile(durations, 0.95),
    avgRetries:
      jobs.length === 0
        ? null
        : Number((jobs.reduce((a, j) => a + j.retryCount, 0) / jobs.length).toFixed(2)),
    lines: {
      total: lineTotal,
      failed: lineFailed,
      conflict: lineConflict,
      failureRate: lineTotal === 0 ? null : lineFailed / lineTotal,
    },
    deadLetters: jobs.filter((j) => j.status === "DEAD_LETTER").length,
  };
}

/** 百分比展示:**null 显示为「无样本」而不是 0%** */
export function formatRate(v: number | null): string {
  return v === null ? "无样本" : `${Math.round(v * 100)}%`;
}

/** 耗时展示:null 显示为「未知」 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "未知";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`;
  return `${(ms / 60_000).toFixed(1)} 分`;
}
