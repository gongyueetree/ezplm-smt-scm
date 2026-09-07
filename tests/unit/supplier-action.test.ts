/**
 * F3:免登录确认的 token 纪律与状态语义(设计 docs/design/F3-CHECKPOINT-A.md)。
 */
import { describe, expect, it } from "vitest";
import {
  buildConfirmUrl,
  classifyAccess,
  canRespond,
  expiryFromDays,
  generateActionToken,
  hashActionToken,
  tokenAuditRef,
  toAckDecision,
  validateOpoEta,
  validatePoConfirm,
  PoConfirmResponseSchema,
} from "@/lib/domain/supplier-action";
import { rateLimit } from "@/lib/server/rate-limit";

describe("token 生成与哈希", () => {
  it("raw 为 base64url ≥43 字符;hash 是 64 位 hex 且可复算;两次生成互不相同", () => {
    const a = generateActionToken();
    const b = generateActionToken();
    expect(a.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashActionToken(a.raw)).toBe(a.hash);
    expect(a.raw).not.toBe(b.raw);
  });

  it("审计只允许 hash 前 8 位;raw 不出现在任何持久化产物里", () => {
    const t = generateActionToken();
    const ref = tokenAuditRef(t.hash);
    expect(ref).toHaveLength(8);
    expect(t.raw).not.toContain(ref); // hex 前缀与 base64url 原文无关
  });

  it("有效期夹在 1–60 天", () => {
    const now = new Date("2026-09-07T00:00:00Z");
    expect(expiryFromDays(14, now).toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(expiryFromDays(999, now).getTime() - now.getTime()).toBe(60 * 86400_000);
    expect(expiryFromDays(0, now).getTime() - now.getTime()).toBe(1 * 86400_000);
  });
});

describe("访问判定(404/410/409 语义)", () => {
  const future = new Date(Date.now() + 86400_000);
  const past = new Date(Date.now() - 1000);

  it("未知与已撤销都归 not_found —— 不可区分,防枚举", () => {
    expect(classifyAccess(null)).toBe("not_found");
    expect(classifyAccess({ status: "REVOKED", expiresAt: future })).toBe("not_found");
  });

  it("已响应 → already_responded(重放);过期 → expired", () => {
    expect(classifyAccess({ status: "RESPONDED", expiresAt: future })).toBe("already_responded");
    expect(classifyAccess({ status: "PENDING", expiresAt: past })).toBe("expired");
    expect(classifyAccess({ status: "PENDING", expiresAt: future })).toBe("ok");
  });

  it("**邮件状态不可推导确认状态**:canRespond 只看访问判定,与发送/已读无关", () => {
    // 没有任何参数能把"邮件已发/已读"传进来 —— 类型层面就不可互推
    expect(canRespond("ok")).toBe(true);
    expect(canRespond("already_responded")).toBe(false);
    expect(canRespond("expired")).toBe(false);
    expect(canRespond("not_found")).toBe(false);
  });
});

describe("PO 确认响应校验", () => {
  const base = {
    decision: "CONFIRM_WITH_CHANGES" as const,
    respondedByName: "张三",
    respondedByEmail: "z@s.com",
    supplierNote: null,
    lines: [],
  };

  it("「有变更地确认」必须至少一行真的改了", () => {
    expect(validatePoConfirm(base)).toContain("至少填写一行");
    expect(
      validatePoConfirm({ ...base, lines: [{ lineNo: 1, confirmedQty: "900", confirmedEta: null }] }),
    ).toBeNull();
  });

  it("决定映射:CONFIRM→ACCEPTED / WITH_CHANGES→PARTIAL / CANNOT→REJECTED", () => {
    expect(toAckDecision("CONFIRM")).toBe("ACCEPTED");
    expect(toAckDecision("CONFIRM_WITH_CHANGES")).toBe("PARTIAL");
    expect(toAckDecision("CANNOT_ACCEPT")).toBe("REJECTED");
  });

  it("schema 拒绝非法数量/日期格式", () => {
    expect(
      PoConfirmResponseSchema.safeParse({
        ...base,
        lines: [{ lineNo: 1, confirmedQty: "abc", confirmedEta: null }],
      }).success,
    ).toBe(false);
  });
});

describe("OPO ETA 响应校验", () => {
  it("全空行 = 没回复,拒绝", () => {
    expect(
      validateOpoEta({
        respondedByName: "李四",
        respondedByEmail: "l@s.com",
        lines: [{ opoLineId: "x", replyEta: null, replyQty: null, replyNote: null }],
      }),
    ).toContain("至少回复一行");
  });
});

describe("链接拼装", () => {
  it("APP_PUBLIC_URL 缺失 → 相对路径 + absolute=false(UI 据此提示补域名)", () => {
    const r = buildConfirmUrl("tok", undefined, "");
    expect(r.absolute).toBe(false);
    expect(r.url).toBe("/confirm/tok");
  });

  it("配置后拼绝对地址,尾斜杠归一;basePath 生效", () => {
    expect(buildConfirmUrl("tok", "https://erp.tindie.com/", "").url).toBe("https://erp.tindie.com/confirm/tok");
    expect(buildConfirmUrl("tok", "https://x.cn", "/scm").url).toBe("https://x.cn/scm/confirm/tok");
  });
});

describe("速率限制(滑动窗口)", () => {
  it("窗口内超限拒绝;窗口滑过后恢复", () => {
    const key = `t-${Math.random()}`;
    const t0 = 1_000_000;
    expect(rateLimit(key, 3, 1000, t0)).toBe(true);
    expect(rateLimit(key, 3, 1000, t0 + 10)).toBe(true);
    expect(rateLimit(key, 3, 1000, t0 + 20)).toBe(true);
    expect(rateLimit(key, 3, 1000, t0 + 30)).toBe(false);
    expect(rateLimit(key, 3, 1000, t0 + 1100)).toBe(true);
  });
});
