/**
 * ERP 连接健康度(纯函数)。
 *
 * 原实现只保留"最近一次测试结果",看不出"已经连续失败 8 次"这种趋势 ——
 * 而运维真正需要判断的正是趋势,不是最后一次是否碰巧通了。
 *
 * 纪律:
 * - **从未成功过 ≠ 健康**。新建连接是 `未验证`,不是 Healthy ——
 *   否则一个刚填完还没测过的连接会显示绿灯;
 * - Token 快到期要**提前预警**,不是等它失效后才报 Offline;
 * - 评分只是排序辅助,**判定用明确规则**,不靠一个魔法分数。
 */

export type HealthState = "HEALTHY" | "WARNING" | "OFFLINE" | "UNVERIFIED" | "DISABLED";

export const HEALTH_LABEL: Record<HealthState, string> = {
  HEALTHY: "正常",
  WARNING: "告警",
  OFFLINE: "离线",
  UNVERIFIED: "未验证",
  DISABLED: "已停用",
};

export const HEALTH_TONE: Record<HealthState, "green" | "amber" | "red" | "gray"> = {
  HEALTHY: "green",
  WARNING: "amber",
  OFFLINE: "red",
  UNVERIFIED: "gray",
  DISABLED: "gray",
};

export interface HealthInput {
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  tokenExpiresAt: string | null;
  /** 判定基准时刻 */
  now: string;
  /** 多久没成功算陈旧(小时);默认 24 */
  staleHours?: number;
  /** Token 剩余多久算预警(小时);默认 24 */
  tokenWarnHours?: number;
  /** 连续失败几次转 OFFLINE;默认 3 */
  offlineAfterFailures?: number;
}

export interface HealthResult {
  state: HealthState;
  /** 0–100,仅用于排序,不用于判定 */
  score: number;
  /** 人可读的判定依据 —— 不让人对着一个分数猜 */
  reasons: string[];
  /** Token 剩余小时;不可知时 null */
  tokenHoursLeft: number | null;
  /** 距最近一次成功的小时数;从未成功为 null */
  hoursSinceSuccess: number | null;
}

const MS_PER_HOUR = 3_600_000;

function hoursBetween(fromIso: string | null, toIso: string): number | null {
  if (!fromIso) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / MS_PER_HOUR;
}

export function evaluateHealth(input: HealthInput): HealthResult {
  const staleHours = input.staleHours ?? 24;
  const tokenWarnHours = input.tokenWarnHours ?? 24;
  const offlineAfter = input.offlineAfterFailures ?? 3;

  const hoursSinceSuccess = hoursBetween(input.lastSuccessAt, input.now);
  const tokenHoursLeft =
    input.tokenExpiresAt === null ? null : -(hoursBetween(input.tokenExpiresAt, input.now) ?? 0);

  const reasons: string[] = [];

  if (!input.enabled) {
    return {
      state: "DISABLED",
      score: 0,
      reasons: ["连接已停用"],
      tokenHoursLeft,
      hoursSinceSuccess,
    };
  }

  // 从未成功过:不是健康,也不是离线 —— 是"还没验证过"
  if (input.lastSuccessAt === null) {
    if (input.consecutiveFailures > 0) {
      return {
        state: "OFFLINE",
        score: 0,
        reasons: [`从未成功过,已连续失败 ${input.consecutiveFailures} 次`],
        tokenHoursLeft,
        hoursSinceSuccess: null,
      };
    }
    return {
      state: "UNVERIFIED",
      score: 50,
      reasons: ["尚未成功连接过 —— 请先执行连接测试"],
      tokenHoursLeft,
      hoursSinceSuccess: null,
    };
  }

  let state: HealthState = "HEALTHY";
  let score = 100;

  if (input.consecutiveFailures >= offlineAfter) {
    state = "OFFLINE";
    reasons.push(`连续失败 ${input.consecutiveFailures} 次(≥${offlineAfter})`);
    score -= 70;
  } else if (input.consecutiveFailures > 0) {
    state = "WARNING";
    reasons.push(`连续失败 ${input.consecutiveFailures} 次`);
    score -= 25 * input.consecutiveFailures;
  }

  if (hoursSinceSuccess !== null && hoursSinceSuccess > staleHours) {
    if (state === "HEALTHY") state = "WARNING";
    reasons.push(`已 ${Math.round(hoursSinceSuccess)} 小时未成功同步(阈值 ${staleHours} 小时)`);
    score -= 20;
  }

  if (tokenHoursLeft !== null) {
    if (tokenHoursLeft <= 0) {
      state = "OFFLINE";
      reasons.push("凭据/Token 已过期");
      score -= 60;
    } else if (tokenHoursLeft <= tokenWarnHours) {
      if (state === "HEALTHY") state = "WARNING";
      reasons.push(`凭据将在 ${Math.round(tokenHoursLeft)} 小时后过期`);
      score -= 15;
    }
  }

  if (reasons.length === 0) reasons.push("最近同步成功,无连续失败");

  return {
    state,
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    tokenHoursLeft,
    hoursSinceSuccess,
  };
}

/**
 * 成功/失败后如何更新连接的健康字段。
 * 抽成纯函数,免得每个调用点各写一遍"成功时要不要清零"。
 */
export function nextHealthFields(
  current: { consecutiveFailures: number },
  outcome: "SUCCESS" | "FAILURE",
  at: string,
  error?: string | null,
): {
  lastSuccessAt?: string;
  lastFailureAt?: string;
  consecutiveFailures: number;
  lastError: string | null;
} {
  if (outcome === "SUCCESS") {
    // 成功必须清零 —— 否则一次偶发失败会永久拉低健康度
    return { lastSuccessAt: at, consecutiveFailures: 0, lastError: null };
  }
  return {
    lastFailureAt: at,
    consecutiveFailures: current.consecutiveFailures + 1,
    lastError: error ?? "未提供错误信息",
  };
}
