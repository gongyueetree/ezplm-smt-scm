/**
 * F3:进程内滑动窗口限流(公开确认接口的单实例兜底)。
 *
 * 边界如实说明:多实例部署下各实例独立计数,真正的边缘限流属部署层
 * (Railway/Cloudflare,已记 DEPLOYMENT.md)。这里挡的是单点脚本滥刷。
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  // 防泄漏:桶数量封顶(被逐出的 key 相当于窗口重置,宁可放过不可涨爆内存)
  if (buckets.size > 10_000) {
    const first = buckets.keys().next().value;
    if (first !== undefined) buckets.delete(first);
  }
  return true;
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}
