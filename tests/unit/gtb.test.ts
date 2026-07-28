import { describe, expect, it } from "vitest";
import { DEFAULT_SCRAP_RATE, calculateGtb } from "@/lib/domain/gtb";

/**
 * GTB 规则(CLAUDE.md):
 * ceil(需求 × (1 + 损耗率)) − 库存 − 在途,不低于 MOQ 再按 SPQ 向上圆整;
 * 损耗率默认 0 且恒标注「待甲方确认」。
 */
describe("GTB 计算", () => {
  it("基础公式:无损耗、无库存在途、无 MOQ/SPQ", () => {
    const r = calculateGtb({ demandQty: 1000 });
    expect(r.grossDemand).toBe("1000");
    expect(r.netDemand).toBe("1000");
    expect(r.purchaseQty).toBe(1000);
  });

  it("损耗率参与毛需求并向上取整(不产生半颗料)", () => {
    const r = calculateGtb({ demandQty: 1000, scrapRate: 0.02 });
    expect(r.grossDemand).toBe("1020");

    const odd = calculateGtb({ demandQty: 333, scrapRate: 0.02 });
    // 333 × 1.02 = 339.66 → ceil = 340
    expect(odd.grossDemand).toBe("340");
  });

  it("扣减库存与在途", () => {
    const r = calculateGtb({ demandQty: 1000, stockQty: 300, inTransitQty: 200 });
    expect(r.netDemand).toBe("500");
    expect(r.purchaseQty).toBe(500);
  });

  it("库存与在途已覆盖需求时采购量为 0,且不被 MOQ 拉起", () => {
    const r = calculateGtb({ demandQty: 100, stockQty: 200, inTransitQty: 50, moq: 500 });
    expect(r.netDemand).toBe("0");
    expect(r.purchaseQty).toBe(0);
    expect(r.steps.join()).toContain("无需采购");
  });

  it("净需求低于 MOQ 时按 MOQ 取,再按 SPQ 向上圆整", () => {
    const r = calculateGtb({ demandQty: 120, moq: 500, spq: 200 });
    // max(120, 500) = 500 → 按 SPQ 200 向上圆整 = 600
    expect(r.purchaseQty).toBe(600);
  });

  it("净需求高于 MOQ 时按净需求圆整", () => {
    const r = calculateGtb({ demandQty: 1050, moq: 500, spq: 100 });
    expect(r.purchaseQty).toBe(1100);
  });

  it("损耗率默认 0 且恒标注待甲方确认", () => {
    const r = calculateGtb({ demandQty: 500 });
    expect(r.scrapRateUsed).toBe(DEFAULT_SCRAP_RATE);
    expect(r.scrapRateConfirmed).toBe(false);
    expect(r.steps.join()).toContain("待甲方确认");
  });

  it("即使显式传入损耗率,也仍标注待甲方确认(口径未经甲方书面确认)", () => {
    const r = calculateGtb({ demandQty: 500, scrapRate: 0.05 });
    expect(r.scrapRateUsed).toBe("0.05");
    expect(r.scrapRateConfirmed).toBe(false);
  });

  it("小数损耗率不产生浮点误差(0.1+0.2 类问题)", () => {
    const r = calculateGtb({ demandQty: 10, scrapRate: 0.1 });
    // 10 × 1.1 = 11 精确,不应出现 11.000000000000002 → ceil 12
    expect(r.grossDemand).toBe("11");
  });

  it("非法/缺省输入按 0 处理,不抛错", () => {
    const r = calculateGtb({
      demandQty: 100,
      scrapRate: null,
      stockQty: undefined,
      inTransitQty: "",
    });
    expect(r.purchaseQty).toBe(100);
    const bad = calculateGtb({ demandQty: 100, scrapRate: "abc" });
    expect(bad.grossDemand).toBe("100");
  });

  it("需求为 0 时采购量为 0", () => {
    expect(calculateGtb({ demandQty: 0, moq: 1000 }).purchaseQty).toBe(0);
  });

  it("计算过程完整留痕(落 gtbSnapshot 供审计)", () => {
    const r = calculateGtb({ demandQty: 1000, scrapRate: 0.02, stockQty: 100, moq: 500, spq: 250 });
    expect(r.steps.length).toBeGreaterThanOrEqual(4);
    expect(r.steps[0]).toContain("毛需求");
    expect(r.steps[1]).toContain("净需求");
    expect(r.steps[2]).toContain("采购量");
  });
});
