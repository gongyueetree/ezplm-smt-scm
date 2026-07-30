import { describe, expect, it } from "vitest";
import {
  checkPoTransition,
  isPoFrozen,
  isPoTerminal,
  PO_STATUS_LABELS,
} from "@/lib/domain/po-status";

describe("PO 状态机:流转与角色", () => {
  it("草稿 → 待价格复核(采购),异常行已清零", () => {
    const r = checkPoTransition({
      from: "DRAFT",
      to: "PENDING_PRICE_REVIEW",
      roles: ["PROCUREMENT"],
      lines: [{ lineNo: 1, hasUnresolvedFlag: false }],
    });
    expect(r.ok).toBe(true);
  });

  it("**异常行未处理不得提交复核**,并指名是哪几行", () => {
    const r = checkPoTransition({
      from: "DRAFT",
      to: "PENDING_PRICE_REVIEW",
      roles: ["PROCUREMENT"],
      lines: [
        { lineNo: 1, hasUnresolvedFlag: false },
        { lineNo: 3, hasUnresolvedFlag: true },
        { lineNo: 5, hasUnresolvedFlag: true },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("flags_unresolved");
    expect(r).toMatchObject({ unresolvedLines: [3, 5] });
    expect(r.message).toContain("3、5");
  });

  it("空订单不得提交", () => {
    const r = checkPoTransition({
      from: "DRAFT",
      to: "PENDING_PRICE_REVIEW",
      roles: ["PROCUREMENT"],
      lines: [],
    });
    expect(r).toMatchObject({ ok: false, code: "no_lines" });
  });

  it("终审只有管理层能批", () => {
    expect(
      checkPoTransition({ from: "PENDING_APPROVAL", to: "APPROVED", roles: ["PROCUREMENT"] }),
    ).toMatchObject({ ok: false, code: "forbidden_role" });
    expect(
      checkPoTransition({ from: "PENDING_APPROVAL", to: "APPROVED", roles: ["MANAGEMENT"] }).ok,
    ).toBe(true);
  });

  it("**退回必须记原因**(价格复核退回与终审退回都要)", () => {
    for (const from of ["PENDING_PRICE_REVIEW", "PENDING_APPROVAL"] as const) {
      expect(
        checkPoTransition({ from, to: "REJECTED", roles: ["MANAGEMENT"] }),
      ).toMatchObject({ ok: false, code: "reason_required" });
      expect(
        checkPoTransition({ from, to: "REJECTED", roles: ["MANAGEMENT"], reason: "单价高于历史价" })
          .ok,
      ).toBe(true);
    }
  });

  it("退回后可回草稿继续改(PO 从未生效,不像报价那样必须开新版本)", () => {
    expect(checkPoTransition({ from: "REJECTED", to: "DRAFT", roles: ["PROCUREMENT"] }).ok).toBe(
      true,
    );
  });

  it("**已批准不可回到可编辑态** —— 要改只能作废后新建", () => {
    for (const to of ["DRAFT", "PENDING_PRICE_REVIEW", "PENDING_APPROVAL"] as const) {
      expect(
        checkPoTransition({ from: "APPROVED", to, roles: ["MANAGEMENT"], reason: "要改价" }),
      ).toMatchObject({ ok: false, code: "not_allowed" });
    }
    expect(
      checkPoTransition({
        from: "APPROVED",
        to: "CANCELLED",
        roles: ["MANAGEMENT"],
        reason: "客户取消需求",
      }).ok,
    ).toBe(true);
  });

  it("已批准只能前进到「已导出 ERP 模板」", () => {
    expect(checkPoTransition({ from: "APPROVED", to: "EXPORTED", roles: ["PROCUREMENT"] }).ok).toBe(
      true,
    );
  });

  it("终态无出路", () => {
    for (const from of ["EXPORTED", "CANCELLED"] as const) {
      expect(
        checkPoTransition({ from, to: "DRAFT", roles: ["MANAGEMENT"], reason: "x" }),
      ).toMatchObject({ ok: false, code: "not_allowed" });
    }
  });
});

describe("PO 冻结与终态", () => {
  it("待复核/待审批/已批准/已导出/已作废 全部冻结,草稿与已退回可改", () => {
    expect(isPoFrozen("DRAFT")).toBe(false);
    expect(isPoFrozen("REJECTED")).toBe(false);
    for (const s of ["PENDING_PRICE_REVIEW", "PENDING_APPROVAL", "APPROVED", "EXPORTED", "CANCELLED"] as const) {
      expect(isPoFrozen(s)).toBe(true);
    }
  });

  it("终态只有已导出与已作废(已退回还能继续改,不算终态)", () => {
    expect(isPoTerminal("EXPORTED")).toBe(true);
    expect(isPoTerminal("CANCELLED")).toBe(true);
    expect(isPoTerminal("REJECTED")).toBe(false);
  });

  it("**没有「已下单」状态** —— ERP 才是下单执行真源,不得出现虚假完成态", () => {
    const labels = Object.values(PO_STATUS_LABELS).join(" ");
    expect(labels).not.toContain("已下单");
    expect(labels).not.toContain("已发送");
    expect(PO_STATUS_LABELS.APPROVED).toContain("待 ERP 录入");
  });
});
