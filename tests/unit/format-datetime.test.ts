/**
 * D-1 回归:面向用户的时间必须按**部署时区**渲染,不能是 UTC。
 *
 * 客户在 PR2 试用反馈里报的原话是「导入 BOM 的时间和实际导入时间不匹配」——
 * 根因是全仓 28 处直接 `toISOString().slice(...)`,而 toISOString 永远是 UTC。
 * 甲方在苏州(UTC+8),于是每个创建/导入/更新时间都早 8 小时。
 */
import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDateTimeSeconds,
} from "@/lib/format/datetime";

/** 2026-08-10 16:30:45 UTC == 2026-08-11 00:30:45 Asia/Shanghai(跨天) */
const CROSS_DAY = new Date("2026-08-10T16:30:45Z");
/** 2026-08-10 02:05:09 UTC == 2026-08-10 10:05:09 Asia/Shanghai(同天) */
const SAME_DAY = new Date("2026-08-10T02:05:09Z");

describe("formatDateTime", () => {
  it("**按 Asia/Shanghai 渲染,不是 UTC** —— 这正是客户报的那个缺陷", () => {
    expect(formatDateTime(SAME_DAY, "-", "Asia/Shanghai")).toBe("2026-08-10 10:05");
    // 反向确认:如果还是 UTC,结果会是 02:05
    expect(formatDateTime(SAME_DAY, "-", "Asia/Shanghai")).not.toContain("02:05");
  });

  it("跨天必须真的跨过去 —— 早 8 小时最容易在日界线上被发现", () => {
    // UTC 是 8 月 10 日晚,上海已经是 8 月 11 日凌晨
    expect(formatDateTime(CROSS_DAY, "-", "Asia/Shanghai")).toBe("2026-08-11 00:30");
    expect(formatDateTime(CROSS_DAY, "-", "UTC")).toBe("2026-08-10 16:30");
  });

  it("不同时区给出不同结果 —— 证明 timeZone 参数真的生效,不是写死的偏移", () => {
    expect(formatDateTime(SAME_DAY, "-", "America/New_York")).toBe("2026-08-09 22:05");
  });

  it("**夏令时时区靠手工加减小时必错**,这里用 Intl 所以正确", () => {
    // 纽约 7 月是 EDT(UTC-4),1 月是 EST(UTC-5);固定偏移做不到
    expect(formatDateTime(new Date("2026-07-01T12:00:00Z"), "-", "America/New_York")).toBe(
      "2026-07-01 08:00",
    );
    expect(formatDateTime(new Date("2026-01-01T12:00:00Z"), "-", "America/New_York")).toBe(
      "2026-01-01 07:00",
    );
  });

  it("午夜显示 00:00 而不是 24:00", () => {
    expect(formatDateTime(new Date("2026-08-10T16:00:00Z"), "-", "Asia/Shanghai")).toBe(
      "2026-08-11 00:00",
    );
  });
});

describe("formatDate", () => {
  it("按时区取日期,跨天时给出的是当地那一天", () => {
    expect(formatDate(CROSS_DAY, "-", "Asia/Shanghai")).toBe("2026-08-11");
    expect(formatDate(CROSS_DAY, "-", "UTC")).toBe("2026-08-10");
  });
});

describe("formatDateTimeSeconds", () => {
  it("日志类到秒", () => {
    expect(formatDateTimeSeconds(SAME_DAY, "-", "Asia/Shanghai")).toBe("2026-08-10 10:05:09");
  });
});

describe("空值与非法值", () => {
  it("**绝不返回 1970-01-01 之类的假时刻**,而是给调用方指定的占位符", () => {
    for (const v of [null, undefined, "", "不是日期", NaN]) {
      expect(formatDateTime(v as never, "-")).toBe("-");
      expect(formatDate(v as never, "不限")).toBe("不限");
    }
  });

  it("占位符可自定义 —— 页面上「未设置」「不限」语义不同", () => {
    expect(formatDate(null, "未设置")).toBe("未设置");
  });

  it("接受字符串与时间戳,不只接受 Date", () => {
    expect(formatDate("2026-08-10T02:05:09Z", "-", "Asia/Shanghai")).toBe("2026-08-10");
    expect(formatDate(SAME_DAY.getTime(), "-", "Asia/Shanghai")).toBe("2026-08-10");
  });
});

/**
 * 结构性守卫:防止将来有人又在页面里写回 `toISOString().slice(...)`。
 *
 * 这条不是"源码关键词自检代替测试" —— 上面的行为用例已经覆盖了格式化本身;
 * 这条守的是**不再退回旧写法**,而那是 grep 唯一能守住的东西。
 */
describe("页面不得再直接渲染 UTC", () => {
  it("app/ 与 components/ 下的 .tsx 里不出现 toISOString().slice", async () => {
    const { readdirSync, readFileSync, statSync } = await import("fs");
    const { join } = await import("path");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".tsx") && /toISOString\(\)\.slice/.test(readFileSync(p, "utf8"))) {
          offenders.push(p);
        }
      }
    };
    walk("app");
    walk("components");

    expect(offenders, `这些页面还在渲染 UTC,请改用 @/lib/format/datetime:\n${offenders.join("\n")}`).toEqual([]);
  });
});
