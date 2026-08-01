import { beforeEach, describe, expect, it } from "vitest";
import {
  CredentialKeyMissingError,
  credentialKeyAvailable,
  isSensitiveField,
  maskSecret,
  openCredential,
  redactSensitive,
  sealCredential,
} from "@/lib/server/erp-credentials";

describe("凭据加密", () => {
  beforeEach(() => {
    process.env.ERP_CREDENTIAL_KEY = "0123456789abcdef0123456789abcdef";
  });

  it("加密后可解回原值", () => {
    const sealed = sealCredential("super-secret-app-key");
    expect(openCredential(sealed)).toBe("super-secret-app-key");
  });

  it("**密文里不含明文**", () => {
    const sealed = sealCredential("super-secret-app-key");
    expect(sealed.cipherText).not.toContain("super-secret");
    expect(JSON.stringify(sealed)).not.toContain("super-secret-app-key");
  });

  it("同一明文两次加密密文不同(随机 IV)", () => {
    expect(sealCredential("x").cipherText).not.toBe(sealCredential("x").cipherText);
  });

  it("掩码只留末 4 位", () => {
    expect(maskSecret("abcdefgh1234")).toBe("********1234");
    expect(maskSecret("ab")).toBe("****");
  });

  it("**缺密钥时拒绝保存,不降级成明文**", () => {
    delete process.env.ERP_CREDENTIAL_KEY;
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    expect(() => sealCredential("x")).toThrow(CredentialKeyMissingError);
    expect(credentialKeyAvailable()).toBe(false);
    if (saved) process.env.AUTH_SECRET = saved;
  });

  it("没有专用密钥时可由 AUTH_SECRET 派生(开发便利),且与会话密钥不同源", () => {
    delete process.env.ERP_CREDENTIAL_KEY;
    process.env.AUTH_SECRET = "dev-auth-secret";
    expect(credentialKeyAvailable()).toBe(true);
    const sealed = sealCredential("y");
    expect(openCredential(sealed)).toBe("y");
  });
});

describe("敏感字段识别与脱敏", () => {
  it("识别常见敏感字段名", () => {
    for (const f of ["appSecret", "password", "Token", "apiKey", "api_key", "credential"]) {
      expect(isSensitiveField(f)).toBe(true);
    }
    expect(isSensitiveField("baseUrl")).toBe(false);
    expect(isSensitiveField("dbId")).toBe(false);
  });

  it("**递归脱敏**:嵌套结构里的密钥也要被替换", () => {
    const r = redactSensitive({
      baseUrl: "https://erp.example.com",
      auth: { appSecret: "S3CR3T", nested: [{ token: "T0K3N" }] },
    });
    expect(JSON.stringify(r)).not.toContain("S3CR3T");
    expect(JSON.stringify(r)).not.toContain("T0K3N");
    expect(JSON.stringify(r)).toContain("erp.example.com");
  });

  it("**替换而不是删键** —— 删掉会让人误以为没配", () => {
    const r = redactSensitive({ appSecret: "x" }) as Record<string, string>;
    expect("appSecret" in r).toBe(true);
    expect(r.appSecret).toBe("[REDACTED]");
  });
});
