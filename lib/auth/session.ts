/**
 * 会话:jose HS256 JWT,httpOnly cookie。
 * Edge 兼容(middleware 中可验签)。密钥仅存服务端环境变量 AUTH_SECRET。
 */
import { SignJWT, jwtVerify } from "jose";
import type { RoleName } from "@/lib/routes";

export const SESSION_COOKIE = "scm_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h

export interface SessionPayload {
  userId: string;
  tenantId: string;
  name: string;
  roles: RoleName[];
}

function secretKey(secret?: string): Uint8Array {
  const s = secret ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET 未配置(仅存服务端环境变量)");
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload, secret?: string): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey(secret));
}

export async function verifySession(
  token: string,
  secret?: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret));
    if (
      typeof payload.userId !== "string" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.name !== "string" ||
      !Array.isArray(payload.roles)
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      tenantId: payload.tenantId,
      name: payload.name,
      roles: payload.roles as RoleName[],
    };
  } catch {
    return null;
  }
}
