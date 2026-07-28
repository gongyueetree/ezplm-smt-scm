import { describe, expect, it } from "vitest";
import {
  RFQ_STATUSES,
  allowedTransitions,
  availableTransitionsFor,
  checkTransition,
  isTerminal,
} from "@/lib/domain/rfq-status";

describe("RFQ 状态机(SPEC §5)", () => {
  it("包含 SPEC 列出的全部 10 个状态", () => {
    expect([...RFQ_STATUSES]).toEqual([
      "DRAFT",
      "RECEIVED",
      "PARSING",
      "WAITING_ENGINEERING",
      "WAITING_PROCUREMENT",
      "QUOTING",
      "PENDING_APPROVAL",
      "QUOTED",
      "CLOSED_NO_QUOTE",
      "LOST",
    ]);
  });

  it("正常推进路径可走通", () => {
    const chain: [string, string][] = [
      ["DRAFT", "RECEIVED"],
      ["RECEIVED", "PARSING"],
      ["PARSING", "WAITING_ENGINEERING"],
      ["WAITING_ENGINEERING", "WAITING_PROCUREMENT"],
      ["WAITING_PROCUREMENT", "QUOTING"],
      ["QUOTING", "PENDING_APPROVAL"],
    ];
    for (const [from, to] of chain) {
      const r = checkTransition({
        from: from as never,
        to: to as never,
        roles: ["MANAGEMENT"],
      });
      expect(r.ok, `${from} → ${to} 应允许`).toBe(true);
    }
  });

  it("跳级流转被拒绝(DRAFT 不能直接到 QUOTED)", () => {
    const r = checkTransition({ from: "DRAFT", to: "QUOTED", roles: ["MANAGEMENT"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_allowed");
  });

  it("终态不可再流转", () => {
    expect(isTerminal("CLOSED_NO_QUOTE")).toBe(true);
    expect(isTerminal("LOST")).toBe(true);
    expect(allowedTransitions("CLOSED_NO_QUOTE")).toEqual([]);
    for (const to of ["QUOTING", "RECEIVED", "QUOTED"] as const) {
      const r = checkTransition({ from: "LOST", to, roles: ["MANAGEMENT"] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("terminal");
    }
  });

  it("「不报价并关闭」在任何非终态都可用,且必须填原因(SPEC §5)", () => {
    for (const from of RFQ_STATUSES.filter((s) => !isTerminal(s))) {
      const withoutReason = checkTransition({
        from,
        to: "CLOSED_NO_QUOTE",
        roles: ["PM"],
      });
      expect(withoutReason.ok, `${from} 关闭时缺原因应被拒`).toBe(false);
      if (!withoutReason.ok) expect(withoutReason.code).toBe("reason_required");

      const withReason = checkTransition({
        from,
        to: "CLOSED_NO_QUOTE",
        roles: ["PM"],
        reason: "客户取消项目",
      });
      expect(withReason.ok, `${from} 关闭时带原因应允许`).toBe(true);
    }
  });

  it("空白原因不算原因", () => {
    const r = checkTransition({
      from: "QUOTING",
      to: "CLOSED_NO_QUOTE",
      roles: ["PM"],
      reason: "   ",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("reason_required");
  });

  it("角色越权被拒绝:采购不能提交审批,工程不能关闭 RFQ", () => {
    const a = checkTransition({ from: "QUOTING", to: "PENDING_APPROVAL", roles: ["PROCUREMENT"] });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe("forbidden_role");

    const b = checkTransition({
      from: "QUOTING",
      to: "CLOSED_NO_QUOTE",
      roles: ["ENGINEERING"],
      reason: "x",
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe("forbidden_role");
  });

  it("MANAGEMENT 可执行任何被允许的流转", () => {
    const r = checkTransition({ from: "PENDING_APPROVAL", to: "QUOTED", roles: ["MANAGEMENT"] });
    expect(r.ok).toBe(true);
  });

  it("审批退回 QUOTING 必须填原因(退回要留痕)", () => {
    const no = checkTransition({ from: "PENDING_APPROVAL", to: "QUOTING", roles: ["MANAGEMENT"] });
    expect(no.ok).toBe(false);
    const yes = checkTransition({
      from: "PENDING_APPROVAL",
      to: "QUOTING",
      roles: ["MANAGEMENT"],
      reason: "毛利率偏低,重算",
    });
    expect(yes.ok).toBe(true);
  });

  it("PM 在报价中可见的流转集合稳定且含关闭", () => {
    const list = availableTransitionsFor("QUOTING", ["PM"]).map((t) => t.to);
    expect(list).toContain("PENDING_APPROVAL");
    expect(list).toContain("CLOSED_NO_QUOTE");
    expect(list).not.toContain("QUOTED"); // 只有管理层能批
  });

  it("工程角色在待工程状态可推进,但看不到关闭按钮", () => {
    const list = availableTransitionsFor("WAITING_ENGINEERING", ["ENGINEERING"]);
    expect(list.map((t) => t.to)).toContain("QUOTING");
    expect(list.map((t) => t.to)).not.toContain("CLOSED_NO_QUOTE");
  });

  it("终态下无任何可选流转(UI 不渲染按钮)", () => {
    expect(availableTransitionsFor("CLOSED_NO_QUOTE", ["MANAGEMENT"])).toEqual([]);
  });
});
