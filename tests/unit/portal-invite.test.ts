/**
 * R3-3:门户邀请流(纯函数)。
 * token 铁律与 F3 同源(直接复用 generateActionToken/hashActionToken),
 * 这里锁访问判定矩阵与链接拼装。
 */
import { describe, expect, it } from "vitest";
import {
  ActivateSchema,
  buildActivateUrl,
  evaluateInviteAccess,
  generateActionToken,
  hashActionToken,
  inviteExpiry,
  tokenAuditRef,
} from "@/lib/domain/portal-invite";

const future = new Date(Date.now() + 3600_000);
const past = new Date(Date.now() - 3600_000);

describe("evaluateInviteAccess", () => {
  it("PENDING 且未过期 → ok", () => {
    expect(evaluateInviteAccess({ status: "PENDING", expiresAt: future }, false)).toEqual({ ok: true });
  });

  it("未知与已撤销**不可区分**(都 not_found,防枚举)", () => {
    const a = evaluateInviteAccess(null, false);
    const b = evaluateInviteAccess({ status: "REVOKED", expiresAt: future }, false);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: false, code: "not_found" });
  });

  it("账号已停用 → 同样 not_found(停用即时截断激活,且与不存在不可区分)", () => {
    const r = evaluateInviteAccess({ status: "PENDING", expiresAt: future }, true);
    expect(r).toMatchObject({ ok: false, code: "not_found" });
  });

  it("已使用 → already_used(提示直接登录)", () => {
    expect(evaluateInviteAccess({ status: "USED", expiresAt: future }, false)).toMatchObject({
      ok: false,
      code: "already_used",
    });
  });

  it("过期 → expired;恰好到期时刻也算过期", () => {
    expect(evaluateInviteAccess({ status: "PENDING", expiresAt: past }, false)).toMatchObject({
      ok: false,
      code: "expired",
    });
    const now = new Date();
    expect(evaluateInviteAccess({ status: "PENDING", expiresAt: now }, false, now)).toMatchObject({
      ok: false,
      code: "expired",
    });
  });

  it("USED 优先于过期(已用的过期链接提示去登录,不是重发)", () => {
    expect(evaluateInviteAccess({ status: "USED", expiresAt: past }, false)).toMatchObject({
      code: "already_used",
    });
  });
});

describe("token 与链接", () => {
  it("原始 token 只在生成时存在;hash 可重算;审计痕迹只有前 8 位", () => {
    const t = generateActionToken();
    expect(t.hash).toBe(hashActionToken(t.raw));
    expect(t.hash).toHaveLength(64);
    expect(tokenAuditRef(t.hash)).toBe(t.hash.slice(0, 8));
  });

  it("邀请有效期 7 天", () => {
    const now = new Date("2026-09-08T00:00:00Z");
    expect(inviteExpiry(now).toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("buildActivateUrl:未配 APP_PUBLIC_URL 相对路径;配置后绝对地址且尾斜杠归一", () => {
    expect(buildActivateUrl("tok", undefined)).toEqual({ url: "/portal/activate/tok", absolute: false });
    expect(buildActivateUrl("tok", "https://erp.tindie.com/").url).toBe("https://erp.tindie.com/portal/activate/tok");
    expect(buildActivateUrl("tok", "https://x.cn", "/scm").url).toBe("https://x.cn/scm/portal/activate/tok");
  });
});

describe("ActivateSchema", () => {
  it("口令 8–100 位", () => {
    expect(ActivateSchema.safeParse({ password: "short" }).success).toBe(false);
    expect(ActivateSchema.safeParse({ password: "long-enough-1" }).success).toBe(true);
    expect(ActivateSchema.safeParse({ password: "x".repeat(101) }).success).toBe(false);
  });
});
