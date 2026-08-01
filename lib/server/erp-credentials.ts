/**
 * ERP 凭据加解密。
 *
 * 纪律(CLAUDE.md 硬性约束 5 的延伸):
 * - 密文入库(AES-256-GCM),**任何接口都不回传明文**,只回掩码;
 * - **缺少加密密钥时拒绝保存**,不降级成明文 —— 明文存 AppSecret 比不存更糟;
 * - 掩码只留末 4 位,够人核对"是不是同一把钥匙",不够任何人拼出原值;
 * - 日志与 AuditLog 只记字段名,不记值(见 repositories/erp-connection.ts)。
 *
 * 密钥来源:`ERP_CREDENTIAL_KEY`(32 字节的 base64 或 hex)。
 * 未单独配置时回落到 `AUTH_SECRET` 派生 —— 便于开发起步,但生产应单独配一把,
 * 这样轮换会话密钥不会连带作废所有 ERP 凭据。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export class CredentialKeyMissingError extends Error {
  constructor() {
    super(
      "未配置 ERP_CREDENTIAL_KEY(也没有 AUTH_SECRET 可派生)—— 拒绝以明文保存 ERP 凭据",
    );
    this.name = "CredentialKeyMissingError";
  }
}

function loadKey(): Buffer {
  const raw = process.env.ERP_CREDENTIAL_KEY?.trim();
  if (raw) {
    // 支持 base64 与 hex 两种写法;长度不对就派生,避免因为格式问题直接不可用
    const asBase64 = Buffer.from(raw, "base64");
    if (asBase64.length === 32) return asBase64;
    const asHex = Buffer.from(raw, "hex");
    if (asHex.length === 32) return asHex;
    return createHash("sha256").update(raw).digest();
  }
  const fallback = process.env.AUTH_SECRET?.trim();
  if (!fallback) throw new CredentialKeyMissingError();
  // 加盐派生,避免与会话签名用同一把
  return createHash("sha256").update(`erp-credential:${fallback}`).digest();
}

export interface SealedCredential {
  cipherText: string;
  iv: string;
  authTag: string;
  maskedHint: string;
}

/** 掩码:只留末 4 位;太短的一律全掩 */
export function maskSecret(plain: string): string {
  const t = plain.trim();
  if (t.length <= 4) return "*".repeat(Math.max(t.length, 4));
  return `${"*".repeat(Math.min(t.length - 4, 12))}${t.slice(-4)}`;
}

export function sealCredential(plain: string): SealedCredential {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    cipherText: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    maskedHint: maskSecret(plain),
  };
}

/**
 * 解密。**只在服务端即将发起 ERP 调用时使用**,解出来的值不得进入任何响应体、
 * 日志、AuditLog 或错误信息。
 */
export function openCredential(sealed: {
  cipherText: string;
  iv: string;
  authTag: string;
}): string {
  const key = loadKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(sealed.cipherText, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** 密钥是否可用 —— UI 用它提示"未配置密钥,凭据无法保存",而不是等保存时才报错 */
export function credentialKeyAvailable(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/** 哪些字段名视为敏感(用于响应与日志过滤) */
export const SENSITIVE_FIELD_PATTERN = /(secret|password|passwd|token|apikey|api_key|credential)/i;

export function isSensitiveField(name: string): boolean {
  return SENSITIVE_FIELD_PATTERN.test(name);
}

/**
 * 递归剔除对象里的敏感字段,用于**响应体与日志**。
 * 值一律替换成 `"[REDACTED]"` —— 不是删掉键,删掉会让人以为没配。
 */
export function redactSensitive<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveField(k) ? "[REDACTED]" : redactSensitive(v);
    }
    return out as T;
  }
  return value;
}
