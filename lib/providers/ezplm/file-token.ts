/**
 * ezPLM 库文件地址是**带签名且短时有效**的(七牛私有空间:`?e=<Unix 秒>&token=...`)。
 *
 * 实测:`e` 距签发约 3 小时;而物料详情按规格类数据缓存 24 小时 ——
 * 如果照搬 24 小时,缓存里的文件地址会在 3 小时后集体变成 401,
 * 页面就会出现"详情有、库文件打不开"的假可用状态。
 *
 * 因此详情缓存的有效期必须**同时受限于最早的文件地址过期时间**。
 */

/** 从签名地址里取出过期时间;取不到返回 null(不猜) */
export function fileUrlExpiry(raw: string): Date | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const e = url.searchParams.get("e");
  if (!e) return null;
  const seconds = Number(e);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/** 一组地址中最早的过期时间;全部取不到时返回 null */
export function earliestFileUrlExpiry(urls: (string | null | undefined)[]): Date | null {
  let earliest: Date | null = null;
  for (const u of urls) {
    if (!u) continue;
    const at = fileUrlExpiry(u);
    if (!at) continue;
    if (!earliest || at < earliest) earliest = at;
  }
  return earliest;
}

/** 安全余量:地址真正过期前就让缓存失效,避免"刚好卡在过期点"的 401 */
export const FILE_URL_SAFETY_MARGIN_MS = 5 * 60 * 1000;

/**
 * 计算详情缓存的实际 TTL(秒)。
 * = min(规格类 TTL, 最早文件地址过期 − 安全余量);至少 60 秒,避免退化成"不缓存"。
 */
export function effectiveDetailTtlSeconds(
  baseTtlSeconds: number,
  urls: (string | null | undefined)[],
  now: Date = new Date(),
): number {
  const earliest = earliestFileUrlExpiry(urls);
  if (!earliest) return baseTtlSeconds;
  const byToken = Math.floor(
    (earliest.getTime() - FILE_URL_SAFETY_MARGIN_MS - now.getTime()) / 1000,
  );
  return Math.max(60, Math.min(baseTtlSeconds, byToken));
}
