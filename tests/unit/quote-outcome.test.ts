import { describe, expect, it } from "vitest";
import { checkOutcomeChange, summarizeConversion } from "@/lib/domain/quote-outcome";
import { checkNreItems, checkTasksBeforeSubmit, summarizeTasks, sumNre } from "@/lib/domain/quote-tasks";

describe("订单结果标记", () => {
  const base = { from: "OPEN" as const, to: "WON" as const, note: null, hasApprovedVersion: true };

  it("从待定标为已中标,不强制填原因", () => {
    expect(checkOutcomeChange(base)).toEqual({ ok: true });
  });

  it("**没有审批通过的版本不许标中标** —— 没报出去的价谈不上中标", () => {
    const r = checkOutcomeChange({ ...base, hasApprovedVersion: false });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("not_approved");
  });

  it("改判(已中标 → 未中标)必须写原因", () => {
    const r = checkOutcomeChange({ from: "WON", to: "LOST", note: null, hasApprovedVersion: true });
    expect(r.ok === false && r.code).toBe("note_required");
    expect(
      checkOutcomeChange({ from: "WON", to: "LOST", note: "客户改判给他家", hasApprovedVersion: true }),
    ).toEqual({ ok: true });
  });

  it("改回「待定」也要写原因 —— 中标数会跟着变", () => {
    const r = checkOutcomeChange({ from: "WON", to: "OPEN", note: "  ", hasApprovedVersion: true });
    expect(r.ok === false && r.code).toBe("note_required");
  });

  it("标成当前已有的结果时明确拒绝,而不是静默成功", () => {
    const r = checkOutcomeChange({ from: "WON", to: "WON", note: "x", hasApprovedVersion: true });
    expect(r.ok === false && r.code).toBe("no_change");
  });
});

describe("订单转化率(与审批通过率不是一回事)", () => {
  it("分母只算定局的报价,**不含待定**", () => {
    const s = summarizeConversion([
      { outcome: "WON", amount: "100.00", currency: "CNY" },
      { outcome: "LOST", amount: null, currency: "CNY" },
      { outcome: "OPEN", amount: null, currency: "CNY" },
      { outcome: "OPEN", amount: null, currency: "CNY" },
    ]);
    // 1 中标 / (1 中标 + 1 未中标) = 0.5;两张待定不进分母
    expect(s.orderConversionRate).toBe(0.5);
    expect(s.pending).toBe(2);
  });

  it("没有任何定局报价时返回 null,**不显示成 0%**", () => {
    const s = summarizeConversion([{ outcome: "OPEN", amount: null, currency: "CNY" }]);
    expect(s.orderConversionRate).toBeNull();
  });

  it("中标金额按币种分开累计,不跨币种相加", () => {
    const s = summarizeConversion([
      { outcome: "WON", amount: "100.10", currency: "CNY" },
      { outcome: "WON", amount: "200.20", currency: "CNY" },
      { outcome: "WON", amount: "50.05", currency: "USD" },
    ]);
    expect(s.wonAmountByCurrency).toEqual({ CNY: "300.30", USD: "50.05" });
  });

  it("**金额未知的中标单独计数,不按 0 计入金额**", () => {
    const s = summarizeConversion([
      { outcome: "WON", amount: null, currency: "CNY" },
      { outcome: "WON", amount: "10.00", currency: "CNY" },
    ]);
    expect(s.wonWithoutAmount).toBe(1);
    expect(s.wonAmountByCurrency.CNY).toBe("10.00");
  });

  it("金额相加走 Decimal,浮点会错的那组数必须算对", () => {
    const s = summarizeConversion([
      { outcome: "WON", amount: "0.1", currency: "CNY" },
      { outcome: "WON", amount: "0.2", currency: "CNY" },
    ]);
    expect(s.wonAmountByCurrency.CNY).toBe("0.30");
  });
});

describe("分项任务", () => {
  it("只有勾了「必须完成」的未回任务才拦提交", () => {
    const rows = [
      { status: "SUBMITTED" as const, required: true },
      { status: "PENDING" as const, required: false },
    ];
    expect(summarizeTasks(rows)).toEqual({ total: 2, submitted: 1, open: 1, blocking: 0 });
    const r = checkTasksBeforeSubmit(rows);
    expect(r.ok).toBe(true);
    // 不阻塞,但要提醒
    expect(r.ok === true && r.warning).toContain("1 项");
  });

  it("必须完成的任务没回时拒绝提交,并说清有几项", () => {
    const r = checkTasksBeforeSubmit([
      { status: "PENDING", required: true },
      { status: "IN_PROGRESS", required: true },
    ]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("2 项");
  });

  it("没有任何任务时放行且不提醒", () => {
    expect(checkTasksBeforeSubmit([])).toEqual({ ok: true, warning: null });
  });
});

describe("NRE 填报", () => {
  it("**金额留空不当 0** —— 「还没填」和「不收费」是两回事", () => {
    const r = checkNreItems([{ definitionId: null, name: "治具费", amount: "", note: null }]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("amount_required");
    expect(r.ok === false && r.message).toContain("不会按 0 处理");
  });

  it("明确填 0 是允许的(确实有免收的项目)", () => {
    const r = checkNreItems([{ definitionId: null, name: "打样费", amount: "0", note: "本次免收" }]);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.items[0].note).toBe("本次免收");
  });

  it("负数与非数字都拒绝", () => {
    expect(checkNreItems([{ definitionId: null, name: "x", amount: "-1", note: null }]).ok).toBe(false);
    expect(checkNreItems([{ definitionId: null, name: "x", amount: "abc", note: null }]).ok).toBe(false);
  });

  it("名称必填 —— 字典项也要带名称快照,字典改名不改写历史报价", () => {
    const r = checkNreItems([{ definitionId: "d1", name: "   ", amount: "100", note: null }]);
    expect(r.ok === false && r.code).toBe("name_required");
  });

  it("空表拒绝,不生成一张没有内容的 NRE", () => {
    expect(checkNreItems([]).ok).toBe(false);
  });

  it("合计走 Decimal", () => {
    expect(sumNre([{ amount: "0.1" }, { amount: "0.2" }])).toBe("0.30");
  });
});
