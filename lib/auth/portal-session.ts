/**
 * F6-B:客户门户会话 —— 与内部会话**完全独立的认证域**(设计 §1)。
 *
 * - Cookie 名不同(portal_session vs scm_session);
 * - 密钥不同(PORTAL_AUTH_SECRET;未配置时门户 503,**不回落共用 AUTH_SECRET**);
 * - 载荷结构不同:必须含 portalAccountId/customerId,**不得含 roles** ——
 *   即使两把密钥被错误配置成同值,载荷校验也会互相拒绝。
 */
import { SignJWT, jwtVerify } from "jose";

export const PORTAL_COOKIE = "portal_session";
export const PORTAL_TTL_SECONDS = 60 * 60 * 4; // 外部用户从紧:4h

export interface PortalSessionPayload {
  portalAccountId: string;
  tenantId: string;
  customerId: string;
  email: string;
}

export function portalSecretConfigured(): boolean {
  return Boolean(process.env.PORTAL_AUTH_SECRET);
}

function secretKey(): Uint8Array {
  const s = process.env.PORTAL_AUTH_SECRET;
  if (!s) throw new Error("PORTAL_AUTH_SECRET 未配置 —— 门户不可用(不回落内部密钥)");
  return new TextEncoder().encode(s);
}

export async function signPortalSession(payload: PortalSessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PORTAL_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyPortalSession(token: string): Promise<PortalSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      typeof payload.portalAccountId !== "string" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.customerId !== "string" ||
      typeof payload.email !== "string" ||
      "roles" in payload // 内部会话结构混进来一律拒绝
    ) {
      return null;
    }
    return {
      portalAccountId: payload.portalAccountId,
      tenantId: payload.tenantId,
      customerId: payload.customerId,
      email: payload.email,
    };
  } catch {
    return null;
  }
}
