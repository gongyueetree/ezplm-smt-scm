/**
 * R3-1:共享限流(公开端点:门户登录/激活、供应商确认)。
 *
 * 修复的两个 P0(ROUND3_AUDIT P0-B):
 * 1. **多实例共享**:原实现是进程内 Map —— N 个实例 = N 倍限额。
 *    现在抽象为 RateLimitProvider:
 *    - MemoryRateLimitProvider:dev/test(单进程语义,够用且零依赖);
 *    - PostgresRateLimitProvider:生产 —— 计数落库,所有实例共享。
 *      **固定窗口**语义(非滑动):公开端点低频写场景足够,如实注明;
 *      不引 Redis(项目现无该依赖,为限流引重基建不划算;Upstash 等可作后续 provider)。
 *    选择:RATE_LIMIT_PROVIDER 环境变量(memory|postgres);
 *    缺省 = 生产 postgres、其余 memory。
 * 2. **IP 可伪造**:x-forwarded-for 首段是客户端可控的(代理通常追加不覆盖)。
 *    现按「可信代理跳数」模型取值:TRUSTED_PROXY_HOPS(默认 1,Railway/Vercel 单层)
 *    从**右往左**取第 N 段 —— 客户端自带的伪造段永远在更左侧,取不到。
 *    hops=0 表示直连部署,此时完全忽略转发头。
 *
 * 失败语义:Postgres 短暂不可用时**放行并记 console.warn**(fail-open)——
 * 限流是防滥用兜底,不能让一次 DB 抖动把所有客户/供应商锁在门外;
 * 部署层(WAF/边缘)仍是第一道限流,应用层是第二道(DEPLOYMENT.md 已注明)。
 */
import { prisma } from "@/lib/server/db";

export interface RateLimitInput {
  /** 逻辑键(如 portal-login:1.2.3.4);调用方负责把 IP 拼进去 */
  key: string;
  /** 窗口内允许的次数 */
  limit: number;
  /** 窗口毫秒数 */
  windowMs: number;
  /** 便于测试注入;缺省取当前时间 */
  now?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** 当前窗口已计数(含本次) */
  count: number;
  /** 本次判定所用的 provider(诊断用) */
  provider: "memory" | "postgres";
  /** provider 故障放行时为 true(监控告警抓手) */
  degraded?: boolean;
}

export interface RateLimitProvider {
  consume(input: RateLimitInput): Promise<RateLimitResult>;
}

// ---------------- Memory(dev/test) ----------------

export class MemoryRateLimitProvider implements RateLimitProvider {
  private buckets = new Map<string, { bucketStart: number; count: number }>();

  async consume(input: RateLimitInput): Promise<RateLimitResult> {
    const now = input.now ?? Date.now();
    const bucketStart = Math.floor(now / input.windowMs) * input.windowMs;
    const existing = this.buckets.get(input.key);
    // 只逐出**过期**桶(修 P2-5:旧实现桶满 FIFO 会误逐活跃 key)
    if (!existing || existing.bucketStart !== bucketStart) {
      this.buckets.set(input.key, { bucketStart, count: 1 });
      this.sweep(now, input.windowMs);
      return { allowed: 1 <= input.limit, count: 1, provider: "memory" };
    }
    existing.count += 1;
    return { allowed: existing.count <= input.limit, count: existing.count, provider: "memory" };
  }

  private sweep(now: number, windowMs: number) {
    if (this.buckets.size < 5000) return;
    for (const [k, v] of this.buckets) {
      if (v.bucketStart + windowMs * 2 < now) this.buckets.delete(k);
    }
  }
}

// ---------------- Postgres(生产:多实例共享) ----------------

export class PostgresRateLimitProvider implements RateLimitProvider {
  async consume(input: RateLimitInput): Promise<RateLimitResult> {
    const now = input.now ?? Date.now();
    const bucketStart = new Date(Math.floor(now / input.windowMs) * input.windowMs);
    try {
      const row = await prisma.rateLimitBucket.upsert({
        where: { key_bucketStart: { key: input.key, bucketStart } },
        update: { count: { increment: 1 } },
        create: { key: input.key, bucketStart, count: 1 },
      });
      // 机会式清理:~2% 的调用顺手删两个窗口前的过期桶
      if (Math.random() < 0.02) {
        void prisma.rateLimitBucket
          .deleteMany({ where: { bucketStart: { lt: new Date(now - input.windowMs * 2) } } })
          .catch(() => {});
      }
      return { allowed: row.count <= input.limit, count: row.count, provider: "postgres" };
    } catch (e) {
      // fail-open:限流兜底不因 DB 抖动锁死公开入口;degraded 供监控
      console.warn("[rate-limit] postgres provider 故障,本次放行:", e instanceof Error ? e.message : e);
      return { allowed: true, count: 0, provider: "postgres", degraded: true };
    }
  }
}

let cached: RateLimitProvider | undefined;

export function getRateLimitProvider(): RateLimitProvider {
  if (cached) return cached;
  const mode =
    process.env.RATE_LIMIT_PROVIDER ??
    (process.env.NODE_ENV === "production" ? "postgres" : "memory");
  cached = mode === "postgres" ? new PostgresRateLimitProvider() : new MemoryRateLimitProvider();
  return cached;
}

/** 测试用:重置缓存的 provider(切换环境变量后生效) */
export function resetRateLimitProviderForTest(): void {
  cached = undefined;
}

/** 便捷封装:消费一次并返回是否放行 */
export async function rateLimitConsume(key: string, limit: number, windowMs: number): Promise<boolean> {
  return (await getRateLimitProvider().consume({ key, limit, windowMs })).allowed;
}

// ---------------- 可信代理 IP 解析 ----------------

/**
 * 按可信跳数解析客户端 IP(R3-1 P0-B 第 2 半)。
 *
 * x-forwarded-for 形如 `伪造段?, 真实客户端, 代理1, 代理2`——
 * 每经过一层可信代理会在**右侧追加一段**。设可信跳数 = N(部署前的可信代理层数),
 * 从右往左第 N 段即真实客户端;客户端自带的伪造头只会把假段推到更左,取不到。
 * N=0(直连/未知部署)→ 完全不信任转发头,返回 null(限流退化为全局键,仍有兜底)。
 */
export function clientIpFromHeaders(
  headers: { get(name: string): string | null },
  trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? "1"),
): string | null {
  if (!Number.isFinite(trustedHops) || trustedHops < 1) return null;
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const idx = parts.length - trustedHops;
    if (idx >= 0) return normalizeIp(parts[idx]);
    // 段数不足可信跳数:头不是可信代理写的(如直连伪造)→ 不信任
    return null;
  }
  // 单层可信代理常见备选头;同样只在 hops>=1 时读
  const real = headers.get("x-real-ip");
  return real ? normalizeIp(real.trim()) : null;
}

/** IPv6 保留冒号形态;IPv4-mapped 前缀剥掉;去端口 */
function normalizeIp(raw: string): string | null {
  let v = raw;
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    if (end > 0) v = v.slice(1, end);
  } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(v)) {
    v = v.slice(0, v.lastIndexOf(":"));
  }
  if (v.toLowerCase().startsWith("::ffff:")) v = v.slice(7);
  return v || null;
}

/** 兼容旧签名(Request 版) */
export function clientIp(req: Request): string | null {
  return clientIpFromHeaders(req.headers);
}
