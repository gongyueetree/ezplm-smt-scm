import { describe, expect, it } from "vitest";
import {
  priorityWeights,
  rankScored,
  scoreAlternate,
  type CandidateSpec,
  type ParamConstraint,
} from "@/lib/domain/alternate-score";

/** 取自截图里的 STM32F103C8T6 场景 */
const CONSTRAINTS: ParamConstraint[] = [
  { key: "core", label: "内核", required: "ARM Cortex-M3" },
  { key: "package", label: "封装", required: "LQFP-48" },
  { key: "freq", label: "最高主频", required: "72 MHz", higherIsBetter: true },
  { key: "flash", label: "Flash", required: "64 KB", higherIsBetter: true },
  { key: "sram", label: "SRAM", required: "20 KB", higherIsBetter: true },
  { key: "voltage", label: "工作电压", required: "2.0 to 3.6 V" },
];

function candidate(over: Partial<CandidateSpec> = {}): CandidateSpec {
  return {
    mpn: "GD32F103C8T6",
    manufacturer: "兆易创新 (GigaDevice)",
    description: "ARM Cortex-M3 国产MCU,108MHz",
    defaultSource: "LOCAL",
    values: {
      core: "ARM Cortex-M3",
      package: "LQFP-48",
      freq: "108 MHz",
      flash: "64 KB",
      sram: "20 KB",
      voltage: "2.6 to 3.6 V",
    },
    ...over,
  };
}

describe("priorityWeights:顺序即优先级", () => {
  it("权重递减且归一", () => {
    const w = priorityWeights(4);
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[1]).toBeGreaterThan(w[2]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("第 1 位与第 2 位差距,明显大于第 9 位与第 10 位", () => {
    const w = priorityWeights(10);
    expect(w[0] - w[1]).toBeGreaterThan((w[8] - w[9]) * 5);
  });
});

describe("scoreAlternate:四个维度", () => {
  const r = scoreAlternate(candidate(), { mode: "PIN_TO_PIN", constraints: CONSTRAINTS });

  it("逐项比对结果带到行上,含判定与依据", () => {
    const freq = r.rows.find((x) => x.key === "freq")!;
    expect(freq.verdict).toBe("更优"); // 108MHz > 72MHz
    const volt = r.rows.find((x) => x.key === "voltage")!;
    expect(volt.verdict).toBe("部分覆盖"); // 2.6–3.6 覆盖不住 2.0–3.6
    expect(volt.detail).toContain("只覆盖");
  });

  it("参数齐全时证据覆盖 100", () => {
    expect(r.evidence).toBe(100);
  });

  it("**Pin-to-Pin 且引脚未验证时,必须给出警示并封顶结论可信**", () => {
    expect(r.warnings.join()).toContain("引脚映射尚未验证");
    expect(r.confidence).toBeLessThanOrEqual(88);
    expect(r.modeTag).toBe("[P2] Pin-to-Pin 候选");
  });

  it("引脚经人工核对后,警示消失且不再封顶", () => {
    const v = scoreAlternate(candidate({ pinMapVerified: true }), {
      mode: "PIN_TO_PIN",
      constraints: CONSTRAINTS,
    });
    expect(v.warnings.join()).not.toContain("引脚映射尚未验证");
    expect(v.modeTag).toBe("[P2] Pin-to-Pin 已验证");
  });
});

describe("未知参数不按 0 分拉低技术分,而是扣「证据覆盖」", () => {
  const partial = candidate({
    values: { core: "ARM Cortex-M3", package: "LQFP-48", freq: null, flash: null, sram: null, voltage: null },
  });
  const r = scoreAlternate(partial, { mode: "FUNCTIONAL", constraints: CONSTRAINTS });

  it("已知项全对 → 技术兼容仍是 100", () => {
    expect(r.technical).toBe(100);
  });

  it("证据覆盖按**权重**计,不是按个数", () => {
    // 6 个参数只覆盖了 2 个,但覆盖的恰好是优先级最高的两项,
    // 所以覆盖度是 61% 而不是 33% —— 这正是"按优先级加权"的意义
    expect(r.evidence).toBeGreaterThan(55);
    expect(r.evidence).toBeLessThan(70);
    expect(r.warnings.join()).toContain("候选未提供");
  });

  it("**结论可信被证据短板拉下来**,不会因为技术 100 就报高分", () => {
    expect(r.confidence).toBeLessThan(r.technical);
  });
});

describe("来源可信:AI 检索来的数据不能与本地库同权", () => {
  it("同样的参数,来源是 AI 搜索时结论可信显著更低", () => {
    const local = scoreAlternate(candidate({ defaultSource: "LOCAL" }), {
      mode: "FUNCTIONAL",
      constraints: CONSTRAINTS,
    });
    const ai = scoreAlternate(candidate({ defaultSource: "AI_SEARCH" }), {
      mode: "FUNCTIONAL",
      constraints: CONSTRAINTS,
    });
    expect(ai.sourceTrust).toBeLessThan(local.sourceTrust);
    expect(ai.confidence).toBeLessThan(local.confidence);
    expect(local.technical).toBe(ai.technical); // 技术分相同 —— 差的是可信度
  });
});

describe("rankScored:排序与同分打破", () => {
  const base = { mode: "FUNCTIONAL" as const, constraints: CONSTRAINTS };

  it("结论可信高的在前", () => {
    const a = candidate({ mpn: "A", defaultSource: "LOCAL" });
    const b = candidate({ mpn: "B", defaultSource: "AI_SEARCH" });
    const scored = [a, b].map((c) => scoreAlternate(c, base));
    expect(rankScored(scored, [a, b], { mode: "FUNCTIONAL" })[0].mpn).toBe("A");
  });

  it("**优选厂商在同分时优先**", () => {
    const a = candidate({ mpn: "A", manufacturer: "Vendor X" });
    const b = candidate({ mpn: "B", manufacturer: "Vendor Y" });
    const scored = [a, b].map((c) =>
      scoreAlternate(c, { ...base, preferredManufacturers: ["Vendor Y"] }),
    );
    expect(rankScored(scored, [a, b], { mode: "FUNCTIONAL" })[0].mpn).toBe("B");
  });

  it("国产替代模式:同分时国产品牌优先", () => {
    const a = candidate({ mpn: "A", domestic: false });
    const b = candidate({ mpn: "B", domestic: true });
    const scored = [a, b].map((c) => scoreAlternate(c, { ...base, mode: "DOMESTIC" }));
    expect(rankScored(scored, [a, b], { mode: "DOMESTIC" })[0].mpn).toBe("B");
  });

  it("低成本模式:同分时单价低者优先;无价者靠后", () => {
    const a = candidate({ mpn: "A", unitPrice: "2.00" });
    const b = candidate({ mpn: "B", unitPrice: "0.70" });
    const c = candidate({ mpn: "C", unitPrice: null });
    const scored = [a, b, c].map((x) => scoreAlternate(x, { ...base, mode: "LOW_COST" }));
    const order = rankScored(scored, [a, b, c], { mode: "LOW_COST" }).map((x) => x.mpn);
    expect(order[0]).toBe("B");
    expect(order.indexOf("C")).toBeGreaterThan(order.indexOf("A"));
  });

  it("limit 生效,且同分时按 MPN 稳定排序", () => {
    const list = ["C", "A", "B"].map((m) => candidate({ mpn: m }));
    const scored = list.map((c) => scoreAlternate(c, base));
    const r1 = rankScored(scored, list, { mode: "FUNCTIONAL", limit: 2 });
    const r2 = rankScored([...scored].reverse(), list, { mode: "FUNCTIONAL", limit: 2 });
    expect(r1.map((x) => x.mpn)).toEqual(r2.map((x) => x.mpn));
    expect(r1).toHaveLength(2);
  });
});
