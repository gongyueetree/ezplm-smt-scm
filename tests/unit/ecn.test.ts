/**
 * F2:ECN-Lite 状态机(docs/design/F2-CHECKPOINT-A.md §2 转移表的测试形)。
 */
import { describe, expect, it } from "vitest";
import {
  buildEcnCode,
  canApplyToBom,
  canDecideStage,
  canReject,
  canRelease,
  canSubmit,
  canVoid,
  currentStage,
  enabledStages,
  isFrozen,
  parseEcnLineRows,
  statusAfterFinalApproval,
  type EcnStageValue,
} from "@/lib/domain/ecn";

describe("阶段序列", () => {
  it("固定顺序 工程→采购→管理;MANAGEMENT 恒在且不可停", () => {
    expect(enabledStages({ engineering: true, procurement: true })).toEqual([
      "ENGINEERING",
      "PROCUREMENT",
      "MANAGEMENT",
    ]);
    expect(enabledStages({ engineering: false, procurement: true })).toEqual(["PROCUREMENT", "MANAGEMENT"]);
    expect(enabledStages({ engineering: false, procurement: false })).toEqual(["MANAGEMENT"]);
  });

  it("currentStage 按已通过集合推进;全通过返回 null", () => {
    const cfg = { engineering: true, procurement: true };
    expect(currentStage(cfg, new Set())).toBe("ENGINEERING");
    expect(currentStage(cfg, new Set<EcnStageValue>(["ENGINEERING"]))).toBe("PROCUREMENT");
    expect(currentStage(cfg, new Set<EcnStageValue>(["ENGINEERING", "PROCUREMENT"]))).toBe("MANAGEMENT");
    expect(currentStage(cfg, new Set<EcnStageValue>(["ENGINEERING", "PROCUREMENT", "MANAGEMENT"]))).toBeNull();
  });

  it("阶段审批人 = 该阶段角色;MANAGEMENT 兼批一切;**无品质/总经理角色**", () => {
    expect(canDecideStage("ENGINEERING", ["ENGINEERING"])).toBe(true);
    expect(canDecideStage("ENGINEERING", ["PROCUREMENT"])).toBe(false);
    expect(canDecideStage("PROCUREMENT", ["MANAGEMENT"])).toBe(true);
    expect(canDecideStage("MANAGEMENT", ["PM"])).toBe(false);
  });
});

describe("状态转移守卫", () => {
  it("提交:仅草稿且 ≥1 变更行", () => {
    expect(canSubmit("DRAFT", 0).ok).toBe(false);
    expect(canSubmit("DRAFT", 1).ok).toBe(true);
    expect(canSubmit("REVIEW", 3).ok).toBe(false);
  });

  it("退回与作废原因必填", () => {
    expect(canReject("REVIEW", "").ok).toBe(false);
    expect(canReject("REVIEW", "封装库存不足").ok).toBe(true);
    expect(canVoid("DRAFT", null).ok).toBe(false);
    expect(canVoid("DRAFT", "重复发起").ok).toBe(true);
  });

  it("**RELEASED 不可作废**(现实无法撤回),只能关闭;终态不可作废", () => {
    expect(canVoid("RELEASED", "想撤回").ok).toBe(false);
    expect(canVoid("RELEASED", "想撤回").reason).toContain("不可作废");
    expect(canVoid("CLOSED", "x").ok).toBe(false);
    expect(canVoid("VOIDED", "x").ok).toBe(false);
  });

  it("发布仅 APPROVED;Apply to BOM 仅 RELEASED", () => {
    expect(canRelease("APPROVED").ok).toBe(true);
    expect(canRelease("REVIEW").ok).toBe(false);
    expect(canApplyToBom("RELEASED").ok).toBe(true);
    expect(canApplyToBom("APPROVED").ok).toBe(false);
  });

  it("末段通过落点:需客户确认→CUSTOMER_CONFIRM,否则 APPROVED", () => {
    expect(statusAfterFinalApproval(true)).toBe("CUSTOMER_CONFIRM");
    expect(statusAfterFinalApproval(false)).toBe("APPROVED");
  });

  it("冻结:REVIEW 起头/行不可改", () => {
    expect(isFrozen("DRAFT")).toBe(false);
    expect(isFrozen("REVIEW")).toBe(true);
    expect(isFrozen("RELEASED")).toBe(true);
  });
});

describe("变更行 CSV 导入", () => {
  it("旧料至少填一个;数量影响须为数字(未知留空不填 0);逐行报错", () => {
    const { lines, errors } = parseEcnLineRows([
      ["", "USB4105-GF-A", "", "USB4110-GF-A", "", "EOL 替换", ""],
      ["", "", "", "NEW-1", "", "缺旧料", ""],
      ["OLD-PN", "", "", "", "abc", "数量非法", ""],
    ]);
    expect(lines).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("第 3 行");
    expect(errors[1]).toContain("不是数字");
  });
});

describe("编号", () => {
  it("ECN-YYYYMMDD-序号", () => {
    expect(buildEcnCode(new Date("2026-09-07T10:00:00Z"), 7)).toBe("ECN-20260907-007");
  });
});
