import { describe, expect, it } from "vitest";
import { convertAmount, convertedNote, type FxRateRecord } from "@/lib/providers/fx";

/**
 * E8 / 客户 Q8:「ERP 系统有汇率显示,请引用」。
 *
 * 守三条:换算叫「换算参考价」;换算必须留痕;
 * **没有汇率就返回 null —— 不猜、不 1:1、不拿旧汇率硬顶**。
 */
const rate = (over: Partial<FxRateRecord> = {}): FxRateRecord => ({
  sourceCurrency: "USD",
  targetCurrency: "CNY",
  rate: "7.2",
  rateType: "即期",
  effectiveDate: "2026-08-12",
  source: "KINGDEE",
  sourceUpdatedAt: null,
  fetchedAt: "2026-08-12T00:00:00.000Z",
  ...over,
});

describe("汇率换算", () => {
  it("同币种直接返回原值,不标估算", () => {
    const r = convertAmount({ amount: "100", sourceCurrency: "CNY", targetCurrency: "CNY", onDate: "2026-08-12", candidates: [] });
    expect(r.convertedAmount).toBe("100");
    expect(r.estimated).toBe(false);
  });

  it("当日汇率:换算正确且不标估算,留痕齐全", () => {
    const r = convertAmount({ amount: "100", sourceCurrency: "USD", targetCurrency: "CNY", onDate: "2026-08-12", candidates: [rate()] });
    expect(r.convertedAmount).toBe("720.00");
    expect(r.estimated).toBe(false);
    // 留痕:六项一个都不能少
    expect(r.rate).toBe("7.2");
    expect(r.rateType).toBe("即期");
    expect(r.fxSource).toBe("KINGDEE");
    expect(r.fxEffectiveDate).toBe("2026-08-12");
    expect(r.fxFetchedAt).toBeTruthy();
    expect(r.originalAmount).toBe("100");
  });

  it("**非当日汇率标为估算**,并提示以原币种为准", () => {
    const r = convertAmount({ amount: "100", sourceCurrency: "USD", targetCurrency: "CNY", onDate: "2026-08-12", candidates: [rate({ effectiveDate: "2026-07-01" })] });
    expect(r.estimated).toBe(true);
    expect(convertedNote(r)).toContain("非当日汇率");
    expect(convertedNote(r)).toContain("以原币种");
  });

  it("取生效日 ≤ 业务日的**最新**一条,不用未来汇率", () => {
    const r = convertAmount({
      amount: "100", sourceCurrency: "USD", targetCurrency: "CNY", onDate: "2026-08-12",
      candidates: [rate({ effectiveDate: "2026-07-01", rate: "7.0" }), rate({ effectiveDate: "2026-08-10", rate: "7.1" }), rate({ effectiveDate: "2026-09-01", rate: "9.9" })],
    });
    expect(r.rate).toBe("7.1");
  });

  it("**没有汇率就返回 null —— 不 1:1、不拿旧汇率顶**", () => {
    const r = convertAmount({ amount: "100", sourceCurrency: "USD", targetCurrency: "CNY", onDate: "2026-08-12", candidates: [] });
    expect(r.convertedAmount).toBeNull();
    expect(r.rate).toBeNull();
    expect(r.unavailableReason).toContain("不会");
    expect(r.unavailableReason).toContain("1:1");
  });

  it("换算走 Decimal —— 浮点会错的那组数必须算对", () => {
    const r = convertAmount({ amount: "0.1", sourceCurrency: "USD", targetCurrency: "CNY", onDate: "2026-08-12", candidates: [rate({ rate: "3" })] });
    expect(r.convertedAmount).toBe("0.30");
  });

  it("**换算价永远带「换算参考价」标签**,不冒充正式报价", () => {
    const r = convertAmount({ amount: "100", sourceCurrency: "USD", targetCurrency: "CNY", onDate: "2026-08-12", candidates: [rate()] });
    expect(convertedNote(r)).toContain("换算参考价");
    expect(convertedNote(r)).toContain("正式报价以原币种为准");
  });
});
