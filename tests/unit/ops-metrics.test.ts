import { describe, expect, it } from "vitest";
import { computeJobMetrics, formatDuration, formatRate, type JobSample } from "@/lib/domain/ops-metrics";

function job(over: Partial<JobSample> = {}): JobSample {
  return {
    status: "SUCCEEDED",
    startedAt: "2026-08-01T10:00:00.000Z",
    finishedAt: "2026-08-01T10:00:05.000Z",
    retryCount: 0,
    createdCount: 10,
    updatedCount: 0,
    unchangedCount: 0,
    skippedCount: 0,
    conflictCount: 0,
    failedCount: 0,
    ...over,
  };
}

describe("computeJobMetrics", () => {
  it("**无样本时返回 null 而不是 0** —— 0% 成功率与「没跑过」是两回事", () => {
    const m = computeJobMetrics([]);
    expect(m.successRate).toBeNull();
    expect(m.avgDurationMs).toBeNull();
    expect(m.avgRetries).toBeNull();
    expect(m.lines.failureRate).toBeNull();
  });

  it("成功率只算**已出结论**的作业,运行中的不计入分母", () => {
    const m = computeJobMetrics([job(), job({ status: "RUNNING" }), job({ status: "FAILED" })]);
    expect(m.successRate).toBe(0.5);
  });

  it("**部分成功单独统计**,不并入成功", () => {
    const m = computeJobMetrics([job(), job({ status: "PARTIAL_SUCCESS", failedCount: 2 })]);
    expect(m.successRate).toBe(0.5);
    expect(m.partialRate).toBe(0.5);
  });

  it("耗时:平均与 P95", () => {
    const m = computeJobMetrics([
      job({ finishedAt: "2026-08-01T10:00:01.000Z" }),
      job({ finishedAt: "2026-08-01T10:00:09.000Z" }),
    ]);
    expect(m.avgDurationMs).toBe(5000);
    expect(m.p95DurationMs).toBe(9000);
  });

  it("**缺开始/结束时间的作业不参与耗时统计**,不按 0 计", () => {
    const m = computeJobMetrics([job({ finishedAt: null }), job({ finishedAt: "2026-08-01T10:00:04.000Z" })]);
    expect(m.avgDurationMs).toBe(4000);
  });

  it("行级失败率按行算,不按作业算", () => {
    const m = computeJobMetrics([job({ createdCount: 97, failedCount: 3, status: "PARTIAL_SUCCESS" })]);
    expect(m.lines.total).toBe(100);
    expect(m.lines.failureRate).toBe(0.03);
  });

  it("平均重试次数", () => {
    const m = computeJobMetrics([job({ retryCount: 0 }), job({ retryCount: 3 })]);
    expect(m.avgRetries).toBe(1.5);
  });

  it("DEAD_LETTER 单独计数 —— 这些是需人工处理的", () => {
    expect(computeJobMetrics([job({ status: "DEAD_LETTER" }), job()]).deadLetters).toBe(1);
  });
});

describe("展示格式", () => {
  it("**null 显示为「无样本」而不是 0%**", () => {
    expect(formatRate(null)).toBe("无样本");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(0.955)).toBe("96%");
  });

  it("耗时 null 显示「未知」", () => {
    expect(formatDuration(null)).toBe("未知");
    expect(formatDuration(500)).toBe("500 ms");
    expect(formatDuration(5500)).toBe("5.5 秒");
    expect(formatDuration(90_000)).toBe("1.5 分");
  });
});
