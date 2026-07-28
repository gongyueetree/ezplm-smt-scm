/**
 * 鉴权层可插拔验签适配器(融合钉子 2)。
 * 一期:LocalSessionVerifier(本地会话 JWT)。
 * 将来:ezPLM 签发 token 跳转 → EzplmJwtVerifierAdapter 验签即登录(L2 SSO)。
 */
import { verifySession, type SessionPayload } from "./session";

export interface VerifiedIdentity {
  /** 本系统 User.id(SSO 场景经 externalUserId 映射后得到) */
  userId: string;
  tenantId: string;
  name: string;
  roles: SessionPayload["roles"];
  /** 身份来源 */
  issuer: "local" | "ezplm";
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity | null>;
}

/** 本地会话验签(一期默认) */
export class LocalSessionVerifier implements TokenVerifier {
  async verify(token: string): Promise<VerifiedIdentity | null> {
    const s = await verifySession(token);
    return s ? { ...s, issuer: "local" } : null;
  }
}

/**
 * ezPLM SSO 验签适配器 —— 状态:待联调(诚实标注)。
 * 约定 JWT claims:tenantId / userId / role / exp(整合方案 7.3 第 3 项);
 * 公钥经 EZPLM_JWT_PUBLIC_KEY 配置后启用,并按 externalUserId 映射本地 User。
 * 在公钥与契约联调完成前,verify 一律返回 null(不伪造通过)。
 */
export class EzplmJwtVerifierAdapter implements TokenVerifier {
  async verify(token: string): Promise<VerifiedIdentity | null> {
    void token; // 待联调:验签实现随 ezPLM 侧 token 签发接口就绪后补(不在此前伪造)
    if (!process.env.EZPLM_JWT_PUBLIC_KEY) return null;
    return null;
  }
}

export function getTokenVerifier(): TokenVerifier {
  return new LocalSessionVerifier();
}
