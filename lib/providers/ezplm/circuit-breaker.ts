/**
 * 熔断器(SPEC §7):连续失败达到阈值 → OPEN(直接拒绝);
 * 冷却期后 HALF_OPEN 放行一次试探,成功即 CLOSED,失败回 OPEN。
 * 时钟可注入,便于确定性单测。
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** 连续失败阈值 */
  failureThreshold: number;
  /** OPEN → HALF_OPEN 的冷却毫秒数 */
  cooldownMs: number;
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = "CLOSED";
  private openedAt = 0;
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  getState(): CircuitState {
    if (this.state === "OPEN" && this.now() - this.openedAt >= this.opts.cooldownMs) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  /** 请求前调用:返回 false 表示应直接拒绝(熔断打开) */
  allowRequest(): boolean {
    return this.getState() !== "OPEN";
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = "CLOSED";
  }

  onFailure(): void {
    this.failures += 1;
    if (this.state === "HALF_OPEN" || this.failures >= this.opts.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = this.now();
    }
  }
}
