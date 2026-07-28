import { describe, expect, it } from "vitest";
import {
  QUOTE_STATUSES,
  availableQuoteTransitions,
  buildQuoteSnapshot,
  checkParameterMutation,
  checkQuoteTransition,
  checkRevisionWrite,
  isFrozen,
  planNextRevision,
  resolveExportSource,
  type QuoteSnapshot,
} from "@/lib/domain/quote-status";
import { summarizeQuote } from "@/lib/domain/quote-calc";

const CONFIRMED = [
  { lineNo: 1, categoryConfirmed: true },
  { lineNo: 2, categoryConfirmed: true },
];

describe("规则 1:状态机 DRAFT→PENDING_APPROVAL→APPROVED/REJECTED/EXPIRED", () => {
  it("状态集合与 SPEC §12 一致", () => {
    expect([...QUOTE_STATUSES]).toEqual([
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "REJECTED",
      "EXPIRED",
    ]);
  });

  it("正常路径:PM 提交 → 管理层批准", () => {
    expect(
      checkQuoteTransition({ from: "DRAFT", to: "PENDING_APPROVAL", roles: ["PM"], lines: CONFIRMED }).ok,
    ).toBe(true);
    expect(
      checkQuoteTransition({ from: "PENDING_APPROVAL", to: "APPROVED", roles: ["MANAGEMENT"] }).ok,
    ).toBe(true);
  });

  it("跳级被拒:草稿不能直接批准", () => {
    const r = checkQuoteTransition({ from: "DRAFT", to: "APPROVED", roles: ["MANAGEMENT"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_allowed");
  });

  it("审批人必须是管理层:PM 不能自批", () => {
    const r = checkQuoteTransition({ from: "PENDING_APPROVAL", to: "APPROVED", roles: ["PM"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("forbidden_role");
  });

  it("采购/工程无权提交报价", () => {
    for (const role of ["PROCUREMENT", "ENGINEERING", "SUPPLIER"] as const) {
      const r = checkQuoteTransition({
        from: "DRAFT",
        to: "PENDING_APPROVAL",
        roles: [role],
        lines: CONFIRMED,
      });
      expect(r.ok, `${role} 不应能提交`).toBe(false);
    }
  });

  it("已退回/已过期无可执行流转", () => {
    expect(availableQuoteTransitions("REJECTED", ["MANAGEMENT"])).toEqual([]);
    expect(availableQuoteTransitions("EXPIRED", ["MANAGEMENT"])).toEqual([]);
  });
});

describe("规则 2:分类未全部人工确认不得提交", () => {
  it("有未确认行即拒绝,并指出是哪几行", () => {
    const r = checkQuoteTransition({
      from: "DRAFT",
      to: "PENDING_APPROVAL",
      roles: ["PM"],
      lines: [
        { lineNo: 1, categoryConfirmed: true },
        { lineNo: 2, categoryConfirmed: false },
        { lineNo: 5, categoryConfirmed: false },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.code === "categories_unconfirmed") {
      expect(r.unconfirmedLines).toEqual([2, 5]);
    } else {
      throw new Error("应为 categories_unconfirmed");
    }
  });

  it("空报价不能提交", () => {
    const r = checkQuoteTransition({ from: "DRAFT", to: "PENDING_APPROVAL", roles: ["PM"], lines: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no_lines");
  });

  it("全部确认后可提交", () => {
    expect(
      checkQuoteTransition({ from: "DRAFT", to: "PENDING_APPROVAL", roles: ["PM"], lines: CONFIRMED }).ok,
    ).toBe(true);
  });
});

describe("规则 4:PENDING / APPROVED 下参数全冻结", () => {
  it("冻结状态判定", () => {
    expect(isFrozen("PENDING_APPROVAL")).toBe(true);
    expect(isFrozen("APPROVED")).toBe(true);
    expect(isFrozen("DRAFT")).toBe(false);
  });

  it("待审批与已批准下任何参数修改都被拒(审批后改折扣被拒)", () => {
    for (const status of ["PENDING_APPROVAL", "APPROVED"] as const) {
      for (const kind of ["edit_line", "add_line", "delete_line", "edit_labor_template", "edit_overhead"] as const) {
        const r = checkParameterMutation(status, kind);
        expect(r.ok, `${status}/${kind} 应被拒`).toBe(false);
        expect(r.message).toContain("Revision");
      }
    }
  });

  it("草稿下可自由修改", () => {
    expect(checkParameterMutation("DRAFT", "edit_line").ok).toBe(true);
  });

  it("已退回/已过期不能就地改,必须新建 Revision", () => {
    expect(checkParameterMutation("REJECTED", "edit_line").ok).toBe(false);
    expect(checkParameterMutation("EXPIRED", "edit_line").ok).toBe(false);
  });
});

describe("规则 3/5:快照冻结与正式导出只用快照", () => {
  const summary = summarizeQuote(
    [{ lineNo: 1, category: "MATERIAL", qty: 100, purchaseCost: "10", markupPct: "0.1" }],
    { currency: "CNY" },
  );
  const snapshot: QuoteSnapshot = buildQuoteSnapshot({
    quoteCode: "Q-20260727-001",
    revision: 1,
    status: "PENDING_APPROVAL",
    currency: "CNY",
    summary,
    laborTemplate: { id: "standard" },
    frozenById: "u1",
    frozenAt: "2026-07-27T10:00:00.000Z",
  });

  it("快照固化整单文档", () => {
    expect(snapshot.summary.grandTotal).toBe("1100.00");
    expect(snapshot.frozenAt).toBe("2026-07-27T10:00:00.000Z");
    expect(snapshot.revision).toBe(1);
  });

  it("已批准导出取 approvedSnapshot", () => {
    const r = resolveExportSource({
      status: "APPROVED",
      approvedSnapshot: { ...snapshot, status: "APPROVED" },
      submittedSnapshot: snapshot,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe("approved");
  });

  it("待审批导出取 submittedSnapshot", () => {
    const r = resolveExportSource({ status: "PENDING_APPROVAL", submittedSnapshot: snapshot });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe("submitted");
  });

  it("缺快照时拒绝导出 —— 绝不用实时数据重算冒充正式文件", () => {
    expect(resolveExportSource({ status: "APPROVED", approvedSnapshot: null }).ok).toBe(false);
    expect(resolveExportSource({ status: "PENDING_APPROVAL", submittedSnapshot: null }).ok).toBe(false);
  });

  it("草稿状态不允许正式导出", () => {
    const r = resolveExportSource({ status: "DRAFT", submittedSnapshot: snapshot });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("快照");
  });

  it("批准后即使实时数据变了,导出仍取批准时的快照(逐字节不漂移)", () => {
    const approved = { ...snapshot, status: "APPROVED" as const };
    const r = resolveExportSource({ status: "APPROVED", approvedSnapshot: approved });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot.summary.grandTotal).toBe("1100.00");
  });
});

describe("规则 6:退回记原因,改动走新 Revision,禁止覆盖已批准版本", () => {
  it("退回必须填原因", () => {
    const without = checkQuoteTransition({
      from: "PENDING_APPROVAL",
      to: "REJECTED",
      roles: ["MANAGEMENT"],
    });
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.code).toBe("reason_required");

    const withReason = checkQuoteTransition({
      from: "PENDING_APPROVAL",
      to: "REJECTED",
      roles: ["MANAGEMENT"],
      reason: "毛利率偏低,材料重新议价",
    });
    expect(withReason.ok).toBe(true);
  });

  it("新修订版号 = 最大号 + 1", () => {
    const plan = planNextRevision([
      { revision: 1, status: "APPROVED" },
      { revision: 2, status: "REJECTED" },
    ]);
    expect(plan.nextRevision).toBe(3);
    expect(plan.approvedRevisions).toEqual([1]);
  });

  it("首个修订版为 1", () => {
    expect(planNextRevision([]).nextRevision).toBe(1);
  });

  it("禁止覆盖已批准版本(错误消息点名 APPROVED)", () => {
    const r = checkRevisionWrite(1, [{ revision: 1, status: "APPROVED" }]);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("已批准");
    expect(r.message).toContain("Revision 2");
  });

  it("禁止覆盖任何既有版本(即使未批准)", () => {
    const r = checkRevisionWrite(2, [
      { revision: 1, status: "APPROVED" },
      { revision: 2, status: "DRAFT" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("已存在");
  });

  it("写入全新版本号被允许", () => {
    expect(checkRevisionWrite(3, [{ revision: 1, status: "APPROVED" }, { revision: 2, status: "REJECTED" }]).ok).toBe(
      true,
    );
  });
});
