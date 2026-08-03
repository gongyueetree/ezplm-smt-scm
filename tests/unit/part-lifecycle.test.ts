import { describe, expect, it } from "vitest";
import { canUseInBom, checkBomUsage, checkPartTransition, type PartStatusValue } from "@/lib/domain/part-lifecycle";

describe("状态流转", () => {
  it("正常路径:草稿 → 待审核 → 启用", () => {
    expect(checkPartTransition({ from: "DRAFT", to: "PENDING_REVIEW" }).ok).toBe(true);
    expect(checkPartTransition({ from: "PENDING_REVIEW", to: "ACTIVE" }).ok).toBe(true);
  });

  it("**草稿直接启用需要审核权限**(等于跳过审核)", () => {
    const denied = checkPartTransition({ from: "DRAFT", to: "ACTIVE" });
    expect(denied.ok).toBe(false);
    expect(denied.ok === false && denied.code).toBe("review_required");
    expect(checkPartTransition({ from: "DRAFT", to: "ACTIVE", canSkipReview: true }).ok).toBe(true);
  });

  it("退回与淘汰**必须写原因**", () => {
    expect(checkPartTransition({ from: "PENDING_REVIEW", to: "REJECTED" }).ok).toBe(false);
    expect(checkPartTransition({ from: "PENDING_REVIEW", to: "REJECTED", reason: "参数缺失" }).ok).toBe(true);
    expect(checkPartTransition({ from: "ACTIVE", to: "OBSOLETE" }).ok).toBe(false);
  });

  it("**仍被 BOM 引用的物料不得淘汰** —— 否则历史 BOM 指向不存在的料", () => {
    const r = checkPartTransition({ from: "ACTIVE", to: "OBSOLETE", reason: "停产", bomUsageCount: 3 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("3 个 BOM 版本引用");
  });

  it("**已淘汰是终态**,不可恢复", () => {
    for (const to of ["ACTIVE", "DRAFT", "DISABLED"] as PartStatusValue[]) {
      const r = checkPartTransition({ from: "OBSOLETE", to, reason: "x" });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.message).toContain("终态");
    }
  });

  it("**停用可逆、淘汰不可逆** —— 两者语义不同", () => {
    expect(checkPartTransition({ from: "DISABLED", to: "ACTIVE" }).ok).toBe(true);
    expect(checkPartTransition({ from: "DISABLED", to: "OBSOLETE", reason: "永久停产" }).ok).toBe(true);
  });

  it("同状态流转被拒", () => {
    expect(checkPartTransition({ from: "ACTIVE", to: "ACTIVE" }).ok).toBe(false);
  });
});

describe("**草稿不得进入正式 BOM**", () => {
  it("只有 ACTIVE 可用于 BOM", () => {
    expect(canUseInBom("ACTIVE")).toBe(true);
    for (const s of ["DRAFT", "PENDING_REVIEW", "REJECTED", "DISABLED", "OBSOLETE"] as PartStatusValue[]) {
      expect(canUseInBom(s)).toBe(false);
    }
  });

  it("每种被拒状态给**不同的**说明,让人知道下一步该做什么", () => {
    const reasons = (["DRAFT", "PENDING_REVIEW", "REJECTED", "DISABLED", "OBSOLETE"] as PartStatusValue[])
      .map((s) => checkBomUsage(s).reason!);
    expect(new Set(reasons).size).toBe(5);
    expect(checkBomUsage("DRAFT").reason).toContain("不得进入正式 BOM");
    expect(checkBomUsage("OBSOLETE").reason).toContain("替代料");
    expect(checkBomUsage("PENDING_REVIEW").reason).toContain("审核");
  });
});
