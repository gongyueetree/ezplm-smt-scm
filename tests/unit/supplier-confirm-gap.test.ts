/**
 * R3-4:CALL_MATERIAL / RFQ_QUOTE 响应体与校验(纯函数)。
 * 访问判定/token 铁律沿用 F3 同一套(supplier-action.test.ts 已锁),这里只锁新增面。
 */
import { describe, expect, it } from "vitest";
import {
  CallMaterialResponseSchema,
  RfqQuoteResponseSchema,
  validateCallMaterial,
  validateRfqQuote,
} from "@/lib/domain/supplier-action";

const who = { respondedByName: "张三", respondedByEmail: "z@sup.example" };

describe("CALL_MATERIAL 响应", () => {
  it("能供必须给量;量必须为正", () => {
    const base = CallMaterialResponseSchema.parse({ ...who, canSupply: true, replyQty: null });
    expect(validateCallMaterial(base)).toMatch(/必须填写可供数量/);
    expect(
      validateCallMaterial(CallMaterialResponseSchema.parse({ ...who, canSupply: true, replyQty: "0" })),
    ).toMatch(/大于 0/);
    expect(
      validateCallMaterial(CallMaterialResponseSchema.parse({ ...who, canSupply: true, replyQty: "300" })),
    ).toBeNull();
  });

  it("不能供时量/交期可空 —— 表态本身就是回复", () => {
    expect(
      validateCallMaterial(CallMaterialResponseSchema.parse({ ...who, canSupply: false })),
    ).toBeNull();
  });

  it("canSupply 必选,不给默认(沉默不是表态)", () => {
    expect(CallMaterialResponseSchema.safeParse({ ...who }).success).toBe(false);
  });
});

describe("RFQ_QUOTE 响应", () => {
  const line = { mpn: "STM32F103C8T6", unitPrice: "12.5" };

  it("单价必须为正", () => {
    const r = RfqQuoteResponseSchema.parse({ ...who, currency: "CNY", lines: [{ ...line, unitPrice: "0" }] });
    expect(validateRfqQuote(r)).toMatch(/单价必须大于 0/);
  });

  it("同一 MPN 重复行拒绝(大小写不敏感,不猜哪行算数)", () => {
    const r = RfqQuoteResponseSchema.parse({
      ...who,
      currency: "CNY",
      lines: [line, { mpn: "stm32f103c8t6", unitPrice: "11" }],
    });
    expect(validateRfqQuote(r)).toMatch(/重复报价行/);
  });

  it("合法输入通过;币种归一大写;有效期/备注可选", () => {
    const r = RfqQuoteResponseSchema.parse({
      ...who,
      currency: "cny",
      lines: [{ ...line, moq: "100", spq: "50", leadTimeDays: 30, validUntil: "2026-12-31", note: "含税" }],
    });
    expect(r.currency).toBe("CNY");
    expect(validateRfqQuote(r)).toBeNull();
  });

  it("空行集与超 200 行拒绝;非法币种拒绝", () => {
    expect(RfqQuoteResponseSchema.safeParse({ ...who, currency: "CNY", lines: [] }).success).toBe(false);
    expect(RfqQuoteResponseSchema.safeParse({ ...who, currency: "RMB¥", lines: [line] }).success).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => ({ mpn: `M${i}`, unitPrice: "1" }));
    expect(RfqQuoteResponseSchema.safeParse({ ...who, currency: "CNY", lines: many }).success).toBe(false);
  });
});
