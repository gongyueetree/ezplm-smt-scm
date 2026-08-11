import { describe, expect, it } from "vitest";
import {
  checkConvertToProduction,
  matchInternalPn,
  matchInternalPns,
  normalizePnKey,
  type InternalPnMatchContext,
} from "@/lib/domain/bom-purpose";

function ctx(opts: {
  customerPn?: Record<string, { partId: string; internalPn: string }>;
  mpn?: Record<string, { partId: string; internalPn: string }[]>;
}): InternalPnMatchContext {
  return {
    byCustomerPn: new Map(Object.entries(opts.customerPn ?? {})),
    byMpn: new Map(Object.entries(opts.mpn ?? {})),
  };
}

describe("内部料号匹配", () => {
  it("客户料号对照表优先于 MPN —— 两者都命中时以对照表为准", () => {
    const c = ctx({
      customerPn: { "CPN001": { partId: "p-cust", internalPn: "EE-CUST" } },
      mpn: { "STM32F103C8T6": [{ partId: "p-mpn", internalPn: "EE-MPN" }] },
    });
    const r = matchInternalPn({ lineNo: 1, customerPn: "CPN-001", mpn: "STM32F103C8T6" }, c);
    expect(r.partId).toBe("p-cust");
    expect(r.source).toBe("CUSTOMER_PN_MAPPING");
  });

  it("对照表没有时退回 MPN 精确匹配", () => {
    const c = ctx({ mpn: { "STM32F103C8T6": [{ partId: "p1", internalPn: "EE-001" }] } });
    const r = matchInternalPn({ lineNo: 1, customerPn: "UNKNOWN", mpn: "stm32f103c8t6" }, c);
    expect(r.internalPn).toBe("EE-001");
    expect(r.source).toBe("MPN_EXACT");
  });

  it("**一个 MPN 命中多颗内部料时不挑一个** —— 标 ambiguous 交人工", () => {
    const c = ctx({
      mpn: {
        "RC0603FR07": [
          { partId: "p1", internalPn: "EE-001" },
          { partId: "p2", internalPn: "EE-002" },
        ],
      },
    });
    const r = matchInternalPn({ lineNo: 3, customerPn: null, mpn: "RC0603FR-07" }, c);
    expect(r.partId).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.reason).toContain("EE-001");
    expect(r.reason).toContain("EE-002");
    expect(r.reason).toContain("不替你选");
  });

  it("匹配不到时给出「不会自动建料」的明确说明,而不是静默留空", () => {
    const r = matchInternalPn({ lineNo: 5, customerPn: "X", mpn: "Y" }, ctx({}));
    expect(r.partId).toBeNull();
    expect(r.ambiguous).toBe(false);
    expect(r.reason).toContain("不会自动建料");
  });

  it("既无客户料号也无 MPN 时说清「无从匹配」,不与「查无此料」混为一谈", () => {
    const r = matchInternalPn({ lineNo: 6, customerPn: null, mpn: null }, ctx({}));
    expect(r.reason).toContain("无从匹配");
  });

  it("归一化只做大小写与分隔符,不做子串匹配 —— 前缀相同的两颗料不得互相命中", () => {
    const c = ctx({ mpn: { "ABC123": [{ partId: "p1", internalPn: "EE-1" }] } });
    // ABC1234 是另一颗料,绝不能命中 ABC123
    expect(matchInternalPn({ lineNo: 1, customerPn: null, mpn: "ABC1234" }, c).partId).toBeNull();
    expect(matchInternalPn({ lineNo: 2, customerPn: null, mpn: "abc-123" }, c).partId).toBe("p1");
  });

  it("normalizePnKey 对空值返回空串,不抛异常", () => {
    expect(normalizePnKey(null)).toBe("");
    expect(normalizePnKey(undefined)).toBe("");
    expect(normalizePnKey("  a-b_c ")).toBe("ABC");
  });

  it("汇总把「歧义」与「完全没匹配」分开计数", () => {
    const c = ctx({
      customerPn: { "A": { partId: "p1", internalPn: "EE-1" } },
      mpn: {
        "DUP": [
          { partId: "p2", internalPn: "EE-2" },
          { partId: "p3", internalPn: "EE-3" },
        ],
      },
    });
    const s = matchInternalPns(
      [
        { lineNo: 1, customerPn: "A", mpn: null },
        { lineNo: 2, customerPn: null, mpn: "DUP" },
        { lineNo: 3, customerPn: null, mpn: "NOPE" },
      ],
      c,
    );
    expect(s.matched).toBe(1);
    expect(s.ambiguous).toBe(1);
    expect(s.unmatched).toBe(1);
    expect(s.needsManual).toBe(2);
  });
});

describe("转正式 BOM 的前置校验", () => {
  const base = {
    sourcePurpose: "PRE_QUOTE" as const,
    customerId: "c1",
    lineCount: 10,
    needsManual: 0,
    acknowledgeUnmatched: false,
  };

  it("全部匹配时放行", () => {
    expect(checkConvertToProduction(base)).toEqual({ ok: true });
  });

  it("正式 BOM 不能再转一次", () => {
    const r = checkConvertToProduction({ ...base, sourcePurpose: "PRODUCTION" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("not_pre_quote");
  });

  it("**没有客户就不许转** —— 客户 Q4:正式 BOM 必须关联客户编码", () => {
    const r = checkConvertToProduction({ ...base, customerId: null });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("customer_required");
  });

  it("空 BOM 不许转", () => {
    const r = checkConvertToProduction({ ...base, lineCount: 0 });
    expect(r.ok === false && r.code).toBe("empty_bom");
  });

  it("有未匹配行时先拦一次,并要求显式确认(C5 待客户最终裁定)", () => {
    const r = checkConvertToProduction({ ...base, needsManual: 3 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.needsAcknowledge).toBe(true);
    expect(r.ok === false && r.message).toContain("3 行");
    expect(r.ok === false && r.message).toContain("待补内部料号");
  });

  it("显式确认后放行 —— 但确认这个动作本身必须由调用方传进来,不能默认成 true", () => {
    expect(checkConvertToProduction({ ...base, needsManual: 3, acknowledgeUnmatched: true })).toEqual({
      ok: true,
    });
  });
});
