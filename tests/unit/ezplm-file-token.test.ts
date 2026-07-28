import { describe, expect, it } from "vitest";
import {
  earliestFileUrlExpiry,
  effectiveDetailTtlSeconds,
  fileUrlExpiry,
  FILE_URL_SAFETY_MARGIN_MS,
} from "@/lib/providers/ezplm/file-token";

const NOW = new Date("2026-07-28T10:00:00.000Z");
const at = (offsetMs: number) =>
  `https://qn.ezplm.com/symbol/x.kicad_sym?e=${Math.floor((NOW.getTime() + offsetMs) / 1000)}&token=t`;

describe("fileUrlExpiry:七牛签名地址的过期时间", () => {
  it("解析 e 参数", () => {
    expect(fileUrlExpiry("https://qn.ezplm.com/a?e=1785281400&token=t")?.toISOString()).toBe(
      new Date(1785281400 * 1000).toISOString(),
    );
  });

  it("没有 e / e 非法 / 不是 URL 时返回 null,不瞎猜", () => {
    expect(fileUrlExpiry("https://qn.ezplm.com/a")).toBeNull();
    expect(fileUrlExpiry("https://qn.ezplm.com/a?e=abc")).toBeNull();
    expect(fileUrlExpiry("https://qn.ezplm.com/a?e=0")).toBeNull();
    expect(fileUrlExpiry("not a url")).toBeNull();
  });

  it("取一组地址中最早的过期时间,忽略空值", () => {
    const e = earliestFileUrlExpiry([at(3 * 3600_000), null, at(1 * 3600_000), undefined]);
    // NOW 是整秒,秒级取整后应恰好等于 NOW + 1 小时
    expect(e?.toISOString()).toBe(new Date(NOW.getTime() + 3600_000).toISOString());
  });

  it("全部取不到过期时间时返回 null", () => {
    expect(earliestFileUrlExpiry([null, "https://qn.ezplm.com/a"])).toBeNull();
  });
});

describe("effectiveDetailTtlSeconds:详情缓存不得比库文件地址活得久", () => {
  const DAY = 24 * 3600;

  it("文件地址 3 小时后过期 → TTL 被压到 3 小时减安全余量", () => {
    const ttl = effectiveDetailTtlSeconds(DAY, [at(3 * 3600_000)], NOW);
    expect(ttl).toBeLessThanOrEqual(3 * 3600 - FILE_URL_SAFETY_MARGIN_MS / 1000);
    expect(ttl).toBeGreaterThan(3 * 3600 - FILE_URL_SAFETY_MARGIN_MS / 1000 - 2);
  });

  it("文件地址比基准 TTL 还长时,仍取基准 TTL", () => {
    expect(effectiveDetailTtlSeconds(DAY, [at(48 * 3600_000)], NOW)).toBe(DAY);
  });

  it("没有可解析的过期时间时按基准 TTL(不因未知就不缓存)", () => {
    expect(effectiveDetailTtlSeconds(DAY, [null, "https://qn.ezplm.com/a"], NOW)).toBe(DAY);
  });

  it("地址已过期/即将过期时兜底 60 秒,不退化成负数 TTL", () => {
    expect(effectiveDetailTtlSeconds(DAY, [at(-3600_000)], NOW)).toBe(60);
    expect(effectiveDetailTtlSeconds(DAY, [at(60_000)], NOW)).toBe(60);
  });
});
