import { describe, expect, it } from "vitest";
import { pickQuoteTemplate, type QuoteTemplateRef } from "@/lib/domain/quote-template";

function tpl(over: Partial<QuoteTemplateRef> = {}): QuoteTemplateRef {
  return {
    id: "t1",
    name: "A 类标准",
    tier: "A",
    defaultMarkupPct: "0.15",
    laborTemplateId: "standard",
    confirmedByBusiness: true,
    ...over,
  };
}

describe("pickQuoteTemplate:按客户等级选模板", () => {
  it("等级完全匹配优先", () => {
    const r = pickQuoteTemplate(
      [tpl({ id: "a", tier: "A" }), tpl({ id: "b", tier: "B", name: "B 类" })],
      "B",
    );
    expect(r.template?.id).toBe("b");
    expect(r.reason).toBe("tier_match");
  });

  it("该等级没配模板 → 回落通用模板,并说明是回落", () => {
    const r = pickQuoteTemplate(
      [tpl({ id: "g", tier: null, name: "通用" }), tpl({ id: "a", tier: "A" })],
      "C",
    );
    expect(r.template?.id).toBe("g");
    expect(r.reason).toBe("generic_fallback");
    expect(r.detail).toContain("回落通用模板");
  });

  it("**客户未评级 ≠ C 级**:落通用模板并明确写出未评级", () => {
    const r = pickQuoteTemplate([tpl({ id: "g", tier: null, name: "通用" }), tpl({ tier: "C" })], null);
    expect(r.template?.id).toBe("g");
    expect(r.reason).toBe("customer_unrated");
    expect(r.detail).toContain("尚未评级");
    expect(r.detail).toContain("不等于 C 级");
  });

  it("完全没有模板时如实说要全部人工填,不编一个默认值", () => {
    const r = pickQuoteTemplate([], "A");
    expect(r.template).toBeNull();
    expect(r.reason).toBe("no_template");
    expect(r.detail).toContain("需全部人工填写");
  });

  it("**默认 Markup 未维护时不猜数字**,提示需人工填写", () => {
    const r = pickQuoteTemplate([tpl({ defaultMarkupPct: null })], "A");
    expect(r.template?.defaultMarkupPct).toBeNull();
    expect(r.detail).toContain("尚未维护默认 Markup");
    // 不得出现任何被系统编出来的百分比
    expect(r.detail).not.toMatch(/\d+\.\d{2}%/);
  });

  it("口径未确认的模板照样可用,但必须带出待确认标记", () => {
    const r = pickQuoteTemplate([tpl({ confirmedByBusiness: false })], "A");
    expect(r.template).not.toBeNull();
    expect(r.needsConfirmationNotice).toBe(true);
    expect(r.detail).toContain("未经业务确认");
  });

  it("同档多套时按名称升序取第一套,结果稳定可复现", () => {
    const a = tpl({ id: "x", name: "乙方案" });
    const b = tpl({ id: "y", name: "甲方案" });
    expect(pickQuoteTemplate([a, b], "A").template?.id).toBe(
      pickQuoteTemplate([b, a], "A").template?.id,
    );
  });
});
