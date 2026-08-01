import { describe, expect, it } from "vitest";
import {
  computeCoverage,
  conclusionCaveat,
  type CoverageInput,
  type SegmentStat,
} from "@/lib/domain/trace-coverage";

function seg(segment: SegmentStat["segment"], expected: number, actual: number): SegmentStat {
  return { segment, expected, actual, coverage: null };
}

function input(over: Partial<CoverageInput> = {}): CoverageInput {
  return {
    segments: [seg("RECEIPT", 10, 10), seg("ISSUE", 10, 10), seg("PRODUCTION", 5, 5), seg("SHIPMENT", 5, 5)],
    timeCompleteness: 1,
    quantityCompleteness: 1,
    gapCount: 0,
    ...over,
  };
}

describe("computeCoverage", () => {
  it("各段齐全 → HIGH", () => {
    const r = computeCoverage(input());
    expect(r.confidence).toBe("HIGH");
    expect(r.score).toBe(100);
  });

  it("**整段缺失时置信度最高只能是 LOW** —— 那意味着下游完全不可见", () => {
    const r = computeCoverage(
      input({ segments: [seg("RECEIPT", 10, 10), seg("ISSUE", 10, 0), seg("PRODUCTION", 5, 5), seg("SHIPMENT", 5, 5)] }),
    );
    expect(r.confidence).toBe("LOW");
    expect(r.missingSegments).toEqual(["ISSUE"]);
    expect(r.reasons.join(" ")).toContain("下游的影响**不可见**");
  });

  it("**空图是 LOW,不是 HIGH** —— 没有数据不等于覆盖完整", () => {
    const r = computeCoverage(
      input({ segments: [seg("RECEIPT", 0, 0), seg("ISSUE", 0, 0), seg("PRODUCTION", 0, 0), seg("SHIPMENT", 0, 0)] }),
    );
    expect(r.confidence).toBe("LOW");
    expect(r.score).toBe(0);
    expect(r.reasons[0]).toContain("请先导入追溯模板");
  });

  it("部分覆盖 → MEDIUM,并指名是哪一段", () => {
    const r = computeCoverage(
      input({ segments: [seg("RECEIPT", 10, 10), seg("ISSUE", 10, 6), seg("PRODUCTION", 5, 5), seg("SHIPMENT", 5, 5)] }),
    );
    expect(r.confidence).toBe("MEDIUM");
    expect(r.reasons.join(" ")).toContain("发料");
  });

  it("有数据缺口时不给 HIGH", () => {
    expect(computeCoverage(input({ gapCount: 2 })).confidence).not.toBe("HIGH");
  });

  it("数量与时间不完整会被指名", () => {
    const r = computeCoverage(input({ quantityCompleteness: 0.3, timeCompleteness: 0.4 }));
    expect(r.reasons.join(" ")).toContain("可折算的数量");
    expect(r.reasons.join(" ")).toContain("时间戳");
  });

  it("expected=0 的段覆盖率为 null,**不按 100% 计**", () => {
    const r = computeCoverage(input({ segments: [seg("RECEIPT", 10, 10), seg("ISSUE", 0, 0), seg("PRODUCTION", 5, 5), seg("SHIPMENT", 5, 5)] }));
    expect(r.segments.find((s) => s.segment === "ISSUE")!.coverage).toBeNull();
  });
});

describe("conclusionCaveat:低置信度不得断言「无影响」", () => {
  it("LOW 必须明写不得据此判定无影响", () => {
    const c = conclusionCaveat("LOW");
    expect(c).toContain("不得据此判定");
    expect(c).toContain("无影响");
  });

  it("HIGH 才允许直接用于决策", () => {
    expect(conclusionCaveat("HIGH")).toContain("可直接用于");
  });

  it("三档措辞互不相同", () => {
    expect(new Set(["HIGH", "MEDIUM", "LOW"].map((c) => conclusionCaveat(c as never))).size).toBe(3);
  });
});
