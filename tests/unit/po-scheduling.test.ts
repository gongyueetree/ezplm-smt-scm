import { describe, expect, it } from "vitest";
import { planPoLine } from "@/lib/domain/po-scheduling";

const TODAY = "2026-07-29T10:00:00.000Z";

describe("planPoLine:按需求日反推下单日", () => {
  it("下单日 = 需求日 − 交期", () => {
    const r = planPoLine({
      requestDate: "2026-09-01",
      leadTimeDays: 30,
      demandQty: 1000,
      today: TODAY,
    });
    expect(r.orderByDate).toBe("2026-08-02");
    expect(r.daysUntilOrderBy).toBe(4);
    expect(r.overdue).toBe(false);
    expect(r.suggestedMode).toBe("FUTURES");
  });

  it("**建议下单日已过 → 判过期并建议现货**", () => {
    const r = planPoLine({
      requestDate: "2026-08-10",
      leadTimeDays: 30,
      demandQty: 500,
      today: TODAY,
    });
    expect(r.orderByDate).toBe("2026-07-11");
    expect(r.daysUntilOrderBy).toBeLessThan(0);
    expect(r.overdue).toBe(true);
    expect(r.suggestedMode).toBe("SPOT");
    expect(r.steps.join(" ")).toContain("已来不及");
  });

  it("恰好是今天下单 → 不算过期", () => {
    const r = planPoLine({
      requestDate: "2026-08-28",
      leadTimeDays: 30,
      demandQty: 10,
      today: TODAY,
    });
    expect(r.orderByDate).toBe("2026-07-29");
    expect(r.daysUntilOrderBy).toBe(0);
    expect(r.overdue).toBe(false);
  });

  it("**交期未预设时不猜** —— 不能拿 0 天当默认给出「今天下单就来得及」", () => {
    const r = planPoLine({
      requestDate: "2026-09-01",
      leadTimeDays: null,
      demandQty: 1000,
      today: TODAY,
    });
    expect(r.orderByDate).toBeNull();
    expect(r.daysUntilOrderBy).toBeNull();
    expect(r.suggestedMode).toBeNull();
    expect(r.overdue).toBe(false);
    expect(r.steps.join(" ")).toContain("交期未预设");
    // 数量仍然要算出来 —— 交期未知不影响 MOQ/SPQ 圆整
    expect(r.purchaseQty).toBe(1000);
  });

  it("日期非法时不反推,也不抛错", () => {
    const r = planPoLine({
      requestDate: "不是日期",
      leadTimeDays: 30,
      demandQty: 10,
      today: TODAY,
    });
    expect(r.orderByDate).toBeNull();
    expect(r.purchaseQty).toBe(10);
  });
});

describe("planPoLine:数量圆整与 GTB 同一套规则", () => {
  it("MOQ 抬底", () => {
    expect(
      planPoLine({ requestDate: "2026-09-01", leadTimeDays: 7, demandQty: 120, moq: 500, today: TODAY })
        .purchaseQty,
    ).toBe(500);
  });

  it("SPQ 向上圆整", () => {
    expect(
      planPoLine({ requestDate: "2026-09-01", leadTimeDays: 7, demandQty: 1200, spq: 500, today: TODAY })
        .purchaseQty,
    ).toBe(1500);
  });

  it("先取 MOQ 下限再按 SPQ 圆整", () => {
    expect(
      planPoLine({
        requestDate: "2026-09-01",
        leadTimeDays: 7,
        demandQty: 100,
        moq: 600,
        spq: 250,
        today: TODAY,
      }).purchaseQty,
    ).toBe(750);
  });

  it("需求为 0 时不因 MOQ 被拉起", () => {
    expect(
      planPoLine({ requestDate: "2026-09-01", leadTimeDays: 7, demandQty: 0, moq: 500, today: TODAY })
        .purchaseQty,
    ).toBe(0);
  });

  it("推导过程逐步可核对(数量与日期各一条)", () => {
    const r = planPoLine({
      requestDate: "2026-09-01",
      leadTimeDays: 30,
      demandQty: 100,
      moq: 500,
      spq: 250,
      today: TODAY,
    });
    expect(r.steps.some((s) => s.includes("MOQ 500") && s.includes("SPQ 250"))).toBe(true);
    expect(r.steps.some((s) => s.includes("建议下单日"))).toBe(true);
  });
});
