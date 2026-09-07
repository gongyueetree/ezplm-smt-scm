/**
 * F6-B:门户认证域与内部认证域**互不接受**(设计 §1)。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";
import {
  PORTAL_COOKIE,
  signPortalSession,
  verifyPortalSession,
} from "@/lib/auth/portal-session";
import { SESSION_COOKIE } from "@/lib/auth/session";

const ENV = { AUTH_SECRET: "internal-secret-for-test", PORTAL_AUTH_SECRET: "portal-secret-for-test" };
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    PORTAL_AUTH_SECRET: process.env.PORTAL_AUTH_SECRET,
  };
  process.env.AUTH_SECRET = ENV.AUTH_SECRET;
  process.env.PORTAL_AUTH_SECRET = ENV.PORTAL_AUTH_SECRET;
});
afterEach(() => {
  process.env.AUTH_SECRET = saved.AUTH_SECRET;
  process.env.PORTAL_AUTH_SECRET = saved.PORTAL_AUTH_SECRET;
});

describe("认证域隔离", () => {
  it("Cookie 名不同 —— 两域在传输层就分开", () => {
    expect(PORTAL_COOKIE).not.toBe(SESSION_COOKIE);
  });

  it("门户 token 过不了内部验签;内部 token 过不了门户验签(密钥不同)", async () => {
    const portalToken = await signPortalSession({
      portalAccountId: "pa1",
      tenantId: "t1",
      customerId: "c1",
      email: "a@b.com",
    });
    const internalToken = await signSession({
      userId: "u1",
      tenantId: "t1",
      name: "内部用户",
      roles: ["MANAGEMENT"],
    });
    expect(await verifySession(portalToken)).toBeNull();
    expect(await verifyPortalSession(internalToken)).toBeNull();
  });

  it("**密钥被错误配置成同值时,载荷校验仍互相拒绝**(纵深防御)", async () => {
    process.env.PORTAL_AUTH_SECRET = ENV.AUTH_SECRET; // 错误配置:两把钥匙同值
    const internalToken = await signSession({
      userId: "u1",
      tenantId: "t1",
      name: "内部用户",
      roles: ["MANAGEMENT"],
    });
    // 内部载荷含 roles、无 portalAccountId → 门户拒绝
    expect(await verifyPortalSession(internalToken)).toBeNull();

    const portalToken = await signPortalSession({
      portalAccountId: "pa1",
      tenantId: "t1",
      customerId: "c1",
      email: "a@b.com",
    });
    // 门户载荷无 userId/name/roles → 内部拒绝
    expect(await verifySession(portalToken)).toBeNull();
  });

  it("PORTAL_AUTH_SECRET 未配置 → 签发直接抛错,不回落内部密钥", async () => {
    delete process.env.PORTAL_AUTH_SECRET;
    await expect(
      signPortalSession({ portalAccountId: "x", tenantId: "t", customerId: "c", email: "e@e.com" }),
    ).rejects.toThrow(/不回落/);
  });
});
