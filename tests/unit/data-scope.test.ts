import { describe, expect, it } from "vitest";
import {
  emptyScopeNotice,
  isRestricted,
  resolveScope,
  type ScopeSubject,
} from "@/lib/domain/data-scope";

function subj(over: Partial<ScopeSubject> = {}): ScopeSubject {
  return { roles: ["PROCUREMENT"], userId: "u1", ...over };
}

describe("resolveScope", () => {
  it("内部角色看全租户", () => {
    for (const r of ["PM", "PROCUREMENT", "ENGINEERING", "MANAGEMENT"] as const) {
      expect(resolveScope(subj({ roles: [r] }), "OPO_LINE").kind).toBe("ALL");
    }
  });

  it("**供应商只看自己的在途行**", () => {
    const s = resolveScope(subj({ roles: ["SUPPLIER"], supplierId: "sup-1" }), "OPO_LINE");
    expect(s.kind).toBe("SUPPLIER");
    expect(s.value).toBe("sup-1");
  });

  it("**归属缺失时是「看不到」而不是「看全部」**", () => {
    const s = resolveScope(subj({ roles: ["SUPPLIER"], supplierId: null }), "OPO_LINE");
    expect(s.kind).toBe("NONE");
    expect(s.description).toContain("而不是放开范围");
  });

  it("供应商对无关资源一律 NONE", () => {
    for (const res of ["RFQ", "QUOTE", "RECONCILIATION", "PART", "BOM"] as const) {
      expect(resolveScope(subj({ roles: ["SUPPLIER"], supplierId: "s" }), res).kind).toBe("NONE");
    }
  });

  it("**兼任内部角色的账号按内部看** —— 但纯供应商永不放宽", () => {
    expect(resolveScope(subj({ roles: ["SUPPLIER", "MANAGEMENT"], supplierId: "s" }), "OPO_LINE").kind).toBe("ALL");
    expect(resolveScope(subj({ roles: ["SUPPLIER"], supplierId: "s" }), "OPO_LINE").kind).toBe("SUPPLIER");
  });

  it("**无角色 → NONE**,不 fallback 到 ALL", () => {
    expect(resolveScope(subj({ roles: [] }), "OPO_LINE").kind).toBe("NONE");
  });
});

describe("提示措辞", () => {
  it("**不能说「没有数据」** —— 要说「你的范围内没有」", () => {
    const s = resolveScope(subj({ roles: ["SUPPLIER"], supplierId: "s" }), "OPO_LINE");
    const notice = emptyScopeNotice(s)!;
    expect(notice).toContain("看不到的部分不代表不存在");
  });

  it("全范围时不提示", () => {
    expect(emptyScopeNotice(resolveScope(subj(), "OPO_LINE"))).toBeNull();
  });

  it("isRestricted 区分受限与全量", () => {
    expect(isRestricted(resolveScope(subj(), "OPO_LINE"))).toBe(false);
    expect(isRestricted(resolveScope(subj({ roles: ["SUPPLIER"], supplierId: "s" }), "OPO_LINE"))).toBe(true);
  });
});
