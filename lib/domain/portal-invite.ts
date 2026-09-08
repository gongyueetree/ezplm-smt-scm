/**
 * R3-3:门户账号邀请/激活(纯函数)。
 *
 * 消除的风险(ROUND3_AUDIT P1-3):管理员代设初始密码并线下传递 ——
 * 现在管理层只建邀请拿一次性链接,**密码由客户在激活页自设**,
 * 管理员全程不知道;passwordChangedAt 记录客户自设时刻。
 *
 * token 铁律与 F3(lib/domain/supplier-action.ts)完全一致:
 * 原始 token 只在生成那一刻存在、库里只有 SHA-256、必有过期、
 * 条件更新单次使用、未知/已撤销一律 not_found 防枚举、日志只记 hash 前 8 位。
 */
import { z } from "zod";
export { generateActionToken, hashActionToken, tokenAuditRef } from "@/lib/domain/supplier-action";

/** 邀请有效期:7 天(激活是一次性动作,不需要 F3 的 14 天窗口) */
export const INVITE_EXPIRY_DAYS = 7;

export function inviteExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 3600 * 1000);
}

export type InviteStatus = "PENDING" | "USED" | "REVOKED";

export type InviteAccess =
  | { ok: true }
  | { ok: false; code: "not_found" | "expired" | "already_used"; reason: string };

/**
 * 访问判定(激活页 GET 与提交 POST 共用):
 * - 未知/已撤销 → not_found(**不可区分**,防枚举);
 * - 过期 → expired(链接确实存在过,提示找管理员重发);
 * - 已用 → already_used(提示直接去登录)。
 * 账号已停用时由调用方传 accountDisabled —— 停用即时截断激活。
 */
export function evaluateInviteAccess(
  invite: { status: InviteStatus; expiresAt: Date } | null,
  accountDisabled: boolean,
  now = new Date(),
): InviteAccess {
  if (!invite || invite.status === "REVOKED") {
    return { ok: false, code: "not_found", reason: "链接无效" };
  }
  if (accountDisabled) {
    // 停用账号的邀请与不存在不可区分(防枚举 + 停用即时生效)
    return { ok: false, code: "not_found", reason: "链接无效" };
  }
  if (invite.status === "USED") {
    return { ok: false, code: "already_used", reason: "该链接已使用,请直接登录门户" };
  }
  if (invite.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: "expired", reason: "链接已过期,请联系管理员重新发起邀请" };
  }
  return { ok: true };
}

/** 激活提交:密码自设,8–100 位(与登录校验同界) */
export const ActivateSchema = z.object({
  password: z.string().min(8, "口令至少 8 位").max(100),
});

/** 激活链接(与 F3 buildConfirmUrl 同规则:未配 APP_PUBLIC_URL 时相对路径并提示) */
export function buildActivateUrl(
  rawToken: string,
  publicUrl: string | undefined,
  basePath = "",
): { url: string; absolute: boolean } {
  const path = `${basePath}/portal/activate/${rawToken}`;
  if (!publicUrl) return { url: path, absolute: false };
  return { url: `${publicUrl.replace(/\/+$/, "")}${path}`, absolute: true };
}
