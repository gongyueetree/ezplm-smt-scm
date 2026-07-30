import { describe, expect, it } from "vitest";
import {
  compareWithHistory,
  reviewPoLine,
  type PoReviewPolicy,
  type PriceHistoryPoint,
} from "@/lib/domain/po-price-review";
import type { QuoteSnapshot } from "@/lib/domain/procurement-flags";

function hist(over: Partial<PriceHistoryPoint> = {}): PriceHistoryPoint {
  return {
    unitPrice: "7.00",
    currency: "CNY",
    supplierId: "S1",
    poNo: "PO-2026-001",
    approvedAt: "2026-05-10T00:00:00.000Z",
    ...over,
  };
}

function quote(over: Partial<QuoteSnapshot> = {}): QuoteSnapshot {
  return {
    supplierId: "S1",
    unitPrice: "7.00",
    currency: "CNY",
    moq: 1,
    spq: 1,
    leadTimeDays: 30,
    quotedAt: "2026-07-29T00:00:00.000Z",
    ...over,
  };
}

const POLICY: PoReviewPolicy = {
  currency: "CNY",
  maxUnitPrice: null,
  maxLeadTimeDays: null,
  confirmedByBusiness: true,
};

describe("compareWithHistory:无历史价 ≠ 价格正常", () => {
  it("**首次采购必须显式说明,不能显示成正常**", () => {
    const r = compareWithHistory({ unitPrice: "7.00", currency: "CNY" }, []);
    expect(r.verdict).toBe("首次采购");
    expect(r.changeRate).toBeNull();
    expect(r.detail).toContain("无同料历史成交价可比");
    expect(r.detail).toContain("非「价格正常」");
  });

  it("当前行没填价 → 不可比,而不是按 0 算跌到底", () => {
    const r = compareWithHistory({ unitPrice: null, currency: "CNY" }, [hist()]);
    expect(r.verdict).toBe("不可比");
    expect(r.changeRate).toBeNull();
  });

  it("**历史价是异币种 → 不可比**,系统不做汇率换算", () => {
    const r = compareWithHistory({ unitPrice: "1.00", currency: "CNY" }, [
      hist({ currency: "USD", unitPrice: "1.00" }),
    ]);
    expect(r.verdict).toBe("不可比");
    expect(r.detail).toContain("不做汇率换算");
    expect(r.detail).toContain("USD");
  });
});

describe("compareWithHistory:涨跌判定", () => {
  it("持平", () => {
    expect(compareWithHistory({ unitPrice: "7.00", currency: "CNY" }, [hist()])).toMatchObject({
      verdict: "持平",
      changeRate: "0",
    });
  });

  it("下降:给出降幅且不带负号", () => {
    const r = compareWithHistory({ unitPrice: "6.30", currency: "CNY" }, [hist()]);
    expect(r.verdict).toBe("下降");
    expect(r.detail).toContain("下降 10%");
    // 降幅不带负号(注意别用裸 "-10" 做断言 —— 参照单据日期 2026-05-10 里就含 "-10")
    expect(r.detail).not.toContain("下降 -10");
  });

  it("上涨未超线(默认 10%)", () => {
    const r = compareWithHistory({ unitPrice: "7.35", currency: "CNY" }, [hist()]);
    expect(r.verdict).toBe("上涨");
    expect(r.detail).toContain("未超告警线");
  });

  it("涨幅超线", () => {
    const r = compareWithHistory({ unitPrice: "8.40", currency: "CNY" }, [hist()]);
    expect(r.verdict).toBe("涨幅超线");
    expect(r.detail).toContain("20%");
    expect(r.detail).toContain("告警线 10%");
  });

  it("取**最近一条**同币种成交,而不是第一条或最低价", () => {
    const r = compareWithHistory({ unitPrice: "7.00", currency: "CNY" }, [
      hist({ unitPrice: "5.00", approvedAt: "2026-01-01T00:00:00.000Z", poNo: "PO-OLD" }),
      hist({ unitPrice: "7.00", approvedAt: "2026-06-01T00:00:00.000Z", poNo: "PO-NEW" }),
    ]);
    expect(r.verdict).toBe("持平");
    expect(r.reference?.poNo).toBe("PO-NEW");
  });

  it("历史里的零价/非法价不参与比较,且**不可比的原因要说对** —— 不能说成异币种", () => {
    const r = compareWithHistory({ unitPrice: "7.00", currency: "CNY" }, [
      hist({ unitPrice: "0", approvedAt: "2026-06-01T00:00:00.000Z" }),
    ]);
    expect(r.verdict).toBe("不可比");
    expect(r.reference).toBeNull();
    expect(r.detail).toContain("单价为零或非法");
    // 同币种却被说成"与当前币种不同"是自相矛盾的提示,曾真实发生
    expect(r.detail).not.toContain("不同");
  });

  it("告警线可配置", () => {
    const r = compareWithHistory({ unitPrice: "7.35", currency: "CNY" }, [hist()], {
      maxIncreaseRate: "0.02",
    });
    expect(r.verdict).toBe("涨幅超线");
  });
});

describe("reviewPoLine:阈值异常复用 evaluateFlags + 历史价一维", () => {
  it("一切正常时无 error", () => {
    const r = reviewPoLine({ lineNo: 1, quote: quote(), history: [hist()] }, POLICY);
    expect(r.hasError).toBe(false);
    expect(r.history.verdict).toBe("持平");
  });

  it("涨幅超线是 **error**,会阻塞提交复核", () => {
    const r = reviewPoLine(
      { lineNo: 2, quote: quote({ unitPrice: "8.40" }), history: [hist()] },
      POLICY,
    );
    expect(r.hasError).toBe(true);
    expect(r.flags.some((f) => f.code === "price_increase_over_limit")).toBe(true);
  });

  it("首次采购是 **info**,不阻塞 —— 否则新料永远下不了单", () => {
    const r = reviewPoLine({ lineNo: 3, quote: quote(), history: [] }, POLICY);
    expect(r.hasError).toBe(false);
    expect(r.flags.some((f) => f.code === "no_price_history" && f.severity === "info")).toBe(true);
  });

  it("超价格线 / 超交期线 / 异币种 都判 error(沿用比价页同一套判定)", () => {
    const strict: PoReviewPolicy = {
      currency: "CNY",
      maxUnitPrice: "6.00",
      maxLeadTimeDays: 20,
      confirmedByBusiness: true,
    };
    const r = reviewPoLine(
      { lineNo: 4, quote: quote({ unitPrice: "9.00", leadTimeDays: 60, currency: "USD" }), history: [] },
      strict,
    );
    expect(r.hasError).toBe(true);
    const codes = r.flags.map((f) => f.code);
    expect(codes).toContain("price_over_limit");
    expect(codes).toContain("lead_time_over_limit");
    expect(codes).toContain("currency_mismatch");
  });

  it("阈值口径未经业务确认时,每条阈值类异常都要带上标注", () => {
    const unconfirmed: PoReviewPolicy = { ...POLICY, maxUnitPrice: "6.00", confirmedByBusiness: false };
    const r = reviewPoLine({ lineNo: 5, quote: quote({ unitPrice: "9.00" }), history: [] }, unconfirmed);
    expect(r.flags.find((f) => f.code === "price_over_limit")?.detail).toContain(
      "演示阈值,非正式风控",
    );
  });
});
