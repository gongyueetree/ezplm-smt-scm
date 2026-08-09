/**
 * 自助注册准入规则。
 *
 * 注册是**唯一**一个未登录就能写库的入口,规则必须能单独测到。
 */
import { describe, expect, it } from "vitest";
import {
  checkRegistration,
  isRegistrationEnabled,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  REGISTRABLE_ROLES,
} from "@/lib/domain/registration";

function base(over: Partial<Parameters<typeof checkRegistration>[0]> = {}) {
  return {
    email: "tester@example.com",
    name: "张三",
    password: "Str0ngPass!",
    role: "PM",
    ...over,
  };
}

describe("isRegistrationEnabled", () => {
  it("**默认关闭** —— 公网部署不能因为忘了配开关就敞开注册", () => {
    expect(isRegistrationEnabled({})).toBe(false);
    expect(isRegistrationEnabled({ ALLOW_SELF_REGISTRATION: undefined })).toBe(false);
  });

  it("只有精确的 'true' 才算开启,含糊值一律当关闭", () => {
    expect(isRegistrationEnabled({ ALLOW_SELF_REGISTRATION: "true" })).toBe(true);
    for (const v of ["1", "yes", "TRUE", "on", "false", ""]) {
      expect(isRegistrationEnabled({ ALLOW_SELF_REGISTRATION: v }), v).toBe(false);
    }
  });
});

describe("normalizeEmail", () => {
  it("去空白 + 全小写 —— 否则 PM@x.cn 能绕过唯一约束注册出第二个同一个人", () => {
    expect(normalizeEmail("  PM@Demo.QianChuang.CN ")).toBe("pm@demo.qianchuang.cn");
  });
});

describe("checkRegistration", () => {
  it("正常输入通过,并返回**规范化后**的值", () => {
    const r = checkRegistration(base({ email: " Tester@Example.COM ", name: "  张三  " }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe("tester@example.com");
      expect(r.value.name).toBe("张三");
    }
  });

  it("邮箱格式不对时拒绝,并指明是哪个字段", () => {
    const r = checkRegistration(base({ email: "not-an-email" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("email");
  });

  it("口令太短时**说清差多少**,不只说太短", () => {
    const r = checkRegistration(base({ password: "abc" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("password");
      expect(r.message).toContain(String(MIN_PASSWORD_LENGTH));
      expect(r.message).toContain("当前 3 位");
    }
  });

  it("演示口令与常见弱口令被拒 —— 用 demo1234 注册等于没设口令", () => {
    for (const p of ["demo1234", "DEMO1234", "12345678", "password"]) {
      const r = checkRegistration(base({ password: p }));
      expect(r.ok, p).toBe(false);
      if (!r.ok) expect(r.field).toBe("password");
    }
  });

  it("角色必须是五个之一,乱填被拒", () => {
    expect(checkRegistration(base({ role: "ADMIN" })).ok).toBe(false);
    for (const role of REGISTRABLE_ROLES) {
      expect(checkRegistration(base({ role, supplierId: "s1" })).ok, role).toBe(true);
    }
  });

  it("**SUPPLIER 必须绑定供应商** —— 空归属的供应商账号登录后处处被拒", () => {
    const r = checkRegistration(base({ role: "SUPPLIER" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("supplierId");
      expect(r.message).toContain("归属");
    }
  });

  it("非供应商角色带来的 supplierId 被丢弃,不落库误导后续判定", () => {
    const r = checkRegistration(base({ role: "PM", supplierId: "s1" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.supplierId).toBeNull();
  });

  it("姓名过短/过长被拒", () => {
    expect(checkRegistration(base({ name: "张" })).ok).toBe(false);
    expect(checkRegistration(base({ name: "x".repeat(51) })).ok).toBe(false);
  });

  it("超长邮箱与口令被拒,避免异常输入落库", () => {
    expect(checkRegistration(base({ email: `${"a".repeat(200)}@x.cn` })).ok).toBe(false);
    expect(checkRegistration(base({ password: "a".repeat(201) })).ok).toBe(false);
  });
});
