import { describe, expect, it } from "vitest";
import { evaluateHealth, nextHealthFields, type HealthInput } from "@/lib/domain/erp-health";

const NOW = "2026-08-01T12:00:00.000Z";

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    enabled: true,
    lastSuccessAt: "2026-08-01T11:00:00.000Z",
    lastFailureAt: null,
    consecutiveFailures: 0,
    tokenExpiresAt: null,
    now: NOW,
    ...over,
  };
}

describe("evaluateHealth", () => {
  it("最近成功且无连续失败 → HEALTHY", () => {
    const h = evaluateHealth(input());
    expect(h.state).toBe("HEALTHY");
    expect(h.score).toBe(100);
  });

  it("**从未成功过不是 HEALTHY,是 UNVERIFIED** —— 刚填完没测过的连接不能显示绿灯", () => {
    const h = evaluateHealth(input({ lastSuccessAt: null }));
    expect(h.state).toBe("UNVERIFIED");
    expect(h.reasons[0]).toContain("尚未成功连接过");
  });

  it("从未成功且已失败过 → OFFLINE(不是 UNVERIFIED)", () => {
    const h = evaluateHealth(input({ lastSuccessAt: null, consecutiveFailures: 2 }));
    expect(h.state).toBe("OFFLINE");
  });

  it("连续失败达阈值 → OFFLINE,未达则 WARNING", () => {
    expect(evaluateHealth(input({ consecutiveFailures: 1 })).state).toBe("WARNING");
    expect(evaluateHealth(input({ consecutiveFailures: 3 })).state).toBe("OFFLINE");
  });

  it("太久没成功 → WARNING,并说明多久", () => {
    const h = evaluateHealth(input({ lastSuccessAt: "2026-07-29T12:00:00.000Z" }));
    expect(h.state).toBe("WARNING");
    expect(h.reasons.join(" ")).toContain("小时未成功同步");
    expect(Math.round(h.hoursSinceSuccess!)).toBe(72);
  });

  it("**Token 快到期要提前预警**,不是等失效才报", () => {
    const h = evaluateHealth(input({ tokenExpiresAt: "2026-08-01T20:00:00.000Z" }));
    expect(h.state).toBe("WARNING");
    expect(h.reasons.join(" ")).toContain("小时后过期");
    expect(Math.round(h.tokenHoursLeft!)).toBe(8);
  });

  it("Token 已过期 → OFFLINE", () => {
    const h = evaluateHealth(input({ tokenExpiresAt: "2026-08-01T11:00:00.000Z" }));
    expect(h.state).toBe("OFFLINE");
    expect(h.reasons.join(" ")).toContain("已过期");
  });

  it("停用的连接单列 DISABLED,不参与健康判定", () => {
    const h = evaluateHealth(input({ enabled: false, consecutiveFailures: 99 }));
    expect(h.state).toBe("DISABLED");
  });

  it("**判定依据必须可读**,不让人对着分数猜", () => {
    const h = evaluateHealth(input({ consecutiveFailures: 2 }));
    expect(h.reasons.length).toBeGreaterThan(0);
    expect(h.reasons[0]).toMatch(/连续失败 2 次/);
  });

  it("阈值可配", () => {
    expect(evaluateHealth(input({ consecutiveFailures: 2, offlineAfterFailures: 2 })).state).toBe("OFFLINE");
  });
});

describe("nextHealthFields", () => {
  it("**成功必须清零连续失败** —— 否则一次偶发失败会永久拉低健康度", () => {
    const r = nextHealthFields({ consecutiveFailures: 7 }, "SUCCESS", NOW);
    expect(r.consecutiveFailures).toBe(0);
    expect(r.lastError).toBeNull();
    expect(r.lastSuccessAt).toBe(NOW);
  });

  it("失败累加并记录错误", () => {
    const r = nextHealthFields({ consecutiveFailures: 2 }, "FAILURE", NOW, "HTTP 500");
    expect(r.consecutiveFailures).toBe(3);
    expect(r.lastError).toBe("HTTP 500");
    expect(r.lastFailureAt).toBe(NOW);
  });

  it("失败但没给错误信息时如实标注,不留空", () => {
    expect(nextHealthFields({ consecutiveFailures: 0 }, "FAILURE", NOW).lastError).toBe("未提供错误信息");
  });
});
