import { describe, expect, it } from "vitest";
import { matchReconLines, matchKey, type ReconSideLine } from "@/lib/domain/recon-match";

function line(over: Partial<ReconSideLine> = {}): ReconSideLine {
  return {
    docNo: "INV-001",
    docLineNo: 1,
    mpn: "STM32F103C8T6",
    qty: "100",
    unitPrice: "7.00",
    amount: "700.00",
    currency: "CNY",
    dueDate: "2026-08-30",
    ...over,
  };
}

describe("matchKey:匹配键优先级", () => {
  it("单据号+行号最优", () => {
    expect(matchKey(line(), 0)).toBe("INV-001#1");
  });
  it("无行号时退到单据号+MPN", () => {
    expect(matchKey(line({ docLineNo: null }), 0)).toBe("INV-001|STM32F103C8T6");
  });
  it("只有 MPN 时用 MPN", () => {
    expect(matchKey(line({ docNo: null, docLineNo: null }), 0)).toBe("MPN|STM32F103C8T6");
  });
  it("全空的行各自占位,**不会互相错配**", () => {
    const a = matchKey(line({ docNo: null, docLineNo: null, mpn: null }), 0);
    const b = matchKey(line({ docNo: null, docLineNo: null, mpn: null }), 1);
    expect(a).not.toBe(b);
  });
});

describe("差异识别", () => {
  it("完全一致", () => {
    const r = matchReconLines([line()], [line()]);
    expect(r.lines[0].verdict).toBe("一致");
    expect(r.lines[0].severity).toBe("info");
    expect(r.summary).toMatchObject({ matched: 1, differing: 0, onlyTheirs: 0, onlyOurs: 0 });
  });

  it("金额差异:给出差额与两侧金额", () => {
    const r = matchReconLines([line({ amount: "750.00" })], [line()]);
    expect(r.lines[0].verdict).toBe("金额差异");
    expect(r.lines[0].diffAmount).toBe("50");
    expect(r.lines[0].severity).toBe("error");
    expect(r.summary.diffTotal).toBe("50");
  });

  it("**金额对得上但数量与单价互相抵消 —— 绝不判一致**", () => {
    // 对方:200 × 3.50 = 700;我方:100 × 7.00 = 700
    const r = matchReconLines(
      [line({ qty: "200", unitPrice: "3.50", amount: "700.00" })],
      [line()],
    );
    expect(r.lines[0].verdict).toBe("数量差异");
    expect(r.lines[0].severity).toBe("error");
    expect(r.lines[0].details.join(" ")).toContain("金额合得上但明细对不上");
    expect(r.summary.matched).toBe(0);
  });

  it("单价差异(数量相同、金额被容差吸收时也要报出来)", () => {
    const r = matchReconLines(
      [line({ unitPrice: "7.0001", amount: "700.00" })],
      [line()],
    );
    expect(r.lines[0].verdict).toBe("单价差异");
  });

  it("容差内的金额尾差判一致", () => {
    const r = matchReconLines([line({ amount: "700.01" })], [line()]);
    expect(r.lines[0].verdict).toBe("一致");
  });

  it("容差可配", () => {
    const r = matchReconLines([line({ amount: "700.50" })], [line()], {
      amountTolerance: "1.00",
    });
    expect(r.lines[0].verdict).toBe("一致");
  });

  it("**异币种判币种不一致,差额为 null,不做换算**", () => {
    const r = matchReconLines([line({ currency: "USD", amount: "100" })], [line()]);
    expect(r.lines[0].verdict).toBe("币种不一致");
    expect(r.lines[0].diffAmount).toBeNull();
    expect(r.lines[0].details.join(" ")).toContain("不做汇率换算");
    expect(r.summary.mixedCurrency).toBe(true);
    // 合计口径 = 对账单币种(对方第一行);另一币种的行**不折算、不并入**
    expect(r.summary.currency).toBe("USD");
    expect(r.summary.theirTotal).toBe("100");
    expect(r.summary.ourTotal).toBe("0");
  });

  it("只在一侧出现的行,说清是「仅对方有」还是「仅我方有」", () => {
    const r = matchReconLines(
      [line({ docNo: "INV-A", docLineNo: 1 })],
      [line({ docNo: "INV-B", docLineNo: 1 })],
    );
    const verdicts = r.lines.map((l) => l.verdict);
    expect(verdicts).toContain("仅对方有");
    expect(verdicts).toContain("仅我方有");
    expect(r.summary).toMatchObject({ onlyTheirs: 1, onlyOurs: 1 });
    // 措辞不得含糊
    expect(r.lines.map((l) => l.details.join(" ")).join(" ")).not.toContain("匹配失败");
  });

  it("缺金额时用 数量 × 单价 推算", () => {
    const r = matchReconLines(
      [line({ amount: null })],
      [line({ amount: null, qty: "100", unitPrice: "7.00" })],
    );
    expect(r.lines[0].verdict).toBe("一致");
  });

  it("一侧金额既没给也推不出 → 明确说金额不可比,不当作 0", () => {
    const r = matchReconLines(
      [line({ amount: null, qty: null, unitPrice: null })],
      [line()],
    );
    expect(r.lines[0].diffAmount).toBeNull();
    expect(r.lines[0].details.join(" ")).toContain("金额不可比");
    expect(r.lines[0].verdict).not.toBe("一致");
  });

  it("同键多行按出现顺序一一配对,不重复消耗同一行", () => {
    const t = [line({ docLineNo: null, amount: "700.00" }), line({ docLineNo: null, amount: "800.00" })];
    const o = [line({ docLineNo: null, amount: "700.00" }), line({ docLineNo: null, amount: "900.00" })];
    const r = matchReconLines(t, o);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].verdict).toBe("一致");
    expect(r.lines[1].verdict).toBe("金额差异");
  });

  it("空对账单不报错", () => {
    const r = matchReconLines([], []);
    expect(r.lines).toEqual([]);
    expect(r.summary.theirTotal).toBe("0");
  });
});
