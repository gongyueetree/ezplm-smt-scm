import { describe, expect, it } from "vitest";
import {
  evaluateFlags,
  isPmConfirmationComplete,
  linesRequiringPmConfirmation,
  procurementProgress,
  unresolvedCount,
  validateResolution,
  type FlaggedLineState,
  type FlagThresholds,
  type QuoteSnapshot,
} from "@/lib/domain/procurement-flags";

/**
 * 异常处理闭环(CLAUDE.md,三轮诊断核心教训)。
 * 每条铁律一组用例。
 */

const THRESHOLDS: FlagThresholds = {
  currency: "CNY",
  maxUnitPrice: "10",
  maxLeadTimeDays: 30,
};

function quote(patch: Partial<QuoteSnapshot> = {}): QuoteSnapshot {
  return {
    supplierId: "sup-1",
    unitPrice: "8",
    currency: "CNY",
    moq: 100,
    spq: 100,
    leadTimeDays: 14,
    quotedAt: "2026-07-27T00:00:00.000Z",
    ...patch,
  };
}

function line(patch: Partial<FlaggedLineState> = {}): FlaggedLineState {
  return {
    lineId: "l1",
    wasFlagged: true,
    flagReasons: [{ code: "price_over_limit", detail: "单价 12 超过价格线 10" }],
    resolution: null,
    ...patch,
  };
}

describe("铁律 1:填价时判定并固化原始异常", () => {
  it("超价格线 / 超交期线 / 异币种 分别被识别", () => {
    expect(evaluateFlags(quote({ unitPrice: "12" }), THRESHOLDS).reasons[0].code).toBe(
      "price_over_limit",
    );
    expect(evaluateFlags(quote({ leadTimeDays: 60 }), THRESHOLDS).reasons[0].code).toBe(
      "lead_time_over_limit",
    );
    expect(evaluateFlags(quote({ currency: "USD" }), THRESHOLDS).reasons[0].code).toBe(
      "currency_mismatch",
    );
  });

  it("多项同时超线时全部列出", () => {
    const r = evaluateFlags(quote({ unitPrice: "99", leadTimeDays: 90, currency: "USD" }), THRESHOLDS);
    expect(r.flagged).toBe(true);
    expect(r.reasons).toHaveLength(3);
  });

  it("达标报价不产生异常", () => {
    expect(evaluateFlags(quote(), THRESHOLDS).flagged).toBe(false);
  });

  it("阈值为空时不校验该项(不臆造标准)", () => {
    const noLimit: FlagThresholds = { currency: "CNY" };
    expect(evaluateFlags(quote({ unitPrice: "9999", leadTimeDays: 999 }), noLimit).flagged).toBe(
      false,
    );
  });

  it("原始异常集合固化后不随阈值放宽而消失", () => {
    const lines = [line({ wasFlagged: true })];
    // 即便把阈值放宽到不再超线,该行仍在 PM 确认范围内
    const relaxed: FlagThresholds = { currency: "CNY", maxUnitPrice: "9999" };
    expect(linesRequiringPmConfirmation(lines)).toHaveLength(1);
    expect(procurementProgress(lines, relaxed).flaggedLines).toBe(1);
  });
});

describe("铁律 2:处理结论默认空,逐项人工选", () => {
  it("未选结论即为未处理", () => {
    const lines = [line({ resolution: null })];
    expect(unresolvedCount(lines, THRESHOLDS)).toBe(1);
    expect(validateResolution(lines[0], THRESHOLDS).ok).toBe(false);
  });

  it("系统不会给出默认结论", () => {
    expect(line().resolution).toBeNull();
  });
});

describe("铁律 3:REQUOTE / 调价 必须带新价并重过校验", () => {
  it("缺新价被拒", () => {
    const r = validateResolution(line({ resolution: "REQUOTE" }), THRESHOLDS);
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("replacement_required");
  });

  it("新价仍超线 → 仍未解决(不允许换个名义放行)", () => {
    const r = validateResolution(
      line({ resolution: "ADJUST_PRICE", replacement: quote({ unitPrice: "11" }) }),
      THRESHOLDS,
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("still_flagged");
  });

  it("新价达标 → 该行解决", () => {
    const r = validateResolution(
      line({ resolution: "REQUOTE", replacement: quote({ unitPrice: "9.5" }) }),
      THRESHOLDS,
    );
    expect(r.ok).toBe(true);
  });

  it("ACCEPT 必须写理由(异常不得被无声吞掉)", () => {
    expect(validateResolution(line({ resolution: "ACCEPT" }), THRESHOLDS).ok).toBe(false);
    expect(
      validateResolution(
        line({ resolution: "ACCEPT", resolutionNote: "客户指定唯一货源,接受溢价" }),
        THRESHOLDS,
      ).ok,
    ).toBe(true);
  });
});

describe("铁律 4:换货源必须记录七要素", () => {
  it("缺任一要素都被拒,并指出缺哪些", () => {
    const incomplete = validateResolution(
      line({
        resolution: "SWITCH_SOURCE",
        replacement: {
          supplierId: "sup-2",
          unitPrice: "7",
          currency: "CNY",
          moq: null,
          spq: null,
          leadTimeDays: null,
          quotedAt: "",
        },
      }),
      THRESHOLDS,
    );
    expect(incomplete.ok).toBe(false);
    const err = incomplete.errors[0];
    expect(err.code).toBe("replacement_incomplete");
    if (err.code === "replacement_incomplete") {
      expect(err.missing).toEqual(["MOQ", "SPQ", "Lead Time", "报价时间"]);
    }
  });

  it("七要素齐备且新价达标 → 通过", () => {
    const r = validateResolution(
      line({
        resolution: "SWITCH_SOURCE",
        replacement: quote({ supplierId: "sup-2", unitPrice: "7", leadTimeDays: 21 }),
      }),
      THRESHOLDS,
    );
    expect(r.ok).toBe(true);
  });

  it("换货源后新价仍超线同样被拒", () => {
    const r = validateResolution(
      line({ resolution: "SWITCH_SOURCE", replacement: quote({ supplierId: "sup-2", unitPrice: "50" }) }),
      THRESHOLDS,
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("still_flagged");
  });
});

describe("铁律 5:PM 确认覆盖全部原始异常行,流程状态用未处理数", () => {
  const lines = [
    line({ lineId: "a", resolution: "ACCEPT", resolutionNote: "唯一货源" }),
    line({ lineId: "b", resolution: "SWITCH_SOURCE", replacement: quote({ supplierId: "s2", unitPrice: "6" }) }),
    line({ lineId: "c", wasFlagged: false, flagReasons: [], resolution: null }),
  ];

  it("已处理完的异常行仍需 PM 确认(不按当前是否仍超线过滤)", () => {
    const need = linesRequiringPmConfirmation(lines).map((l) => l.lineId);
    expect(need).toEqual(["a", "b"]);
    // b 换货源后价格已达标,但依然要 PM 看到
    expect(need).toContain("b");
  });

  it("非异常行不进入 PM 确认范围", () => {
    expect(linesRequiringPmConfirmation(lines).map((l) => l.lineId)).not.toContain("c");
  });

  it("PM 漏确认任一原始异常行即为不完整", () => {
    expect(isPmConfirmationComplete(lines, ["a"])).toEqual({ complete: false, missing: ["b"] });
    expect(isPmConfirmationComplete(lines, ["a", "b"]).complete).toBe(true);
  });

  it("流程状态由未处理数驱动:有未处理即不可反馈 PM", () => {
    const withPending = [...lines, line({ lineId: "d", resolution: null })];
    const p = procurementProgress(withPending, THRESHOLDS);
    expect(p.totalLines).toBe(4);
    expect(p.flaggedLines).toBe(3);
    expect(p.unresolved).toBe(1);
    expect(p.canSubmitToPm).toBe(false);

    const allDone = procurementProgress(lines, THRESHOLDS);
    expect(allDone.unresolved).toBe(0);
    expect(allDone.canSubmitToPm).toBe(true);
  });

  it("无异常行时可直接反馈 PM", () => {
    const clean = [line({ lineId: "x", wasFlagged: false, flagReasons: [] })];
    expect(procurementProgress(clean, THRESHOLDS)).toMatchObject({
      flaggedLines: 0,
      unresolved: 0,
      canSubmitToPm: true,
    });
  });
});
