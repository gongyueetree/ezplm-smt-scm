import { describe, expect, it } from "vitest";
import {
  checkMessageTransition,
  concludeRead,
  readConclusionNote,
  resolveSmtpConfig,
} from "@/lib/domain/mail-receipt";

/**
 * E7 / 客户 Q3:发送 = 公司 SMTP;回执 = **已读回执**。
 *
 * 核心守则:**禁止 SENT = READ**。
 * 「没收到已读回执」不能推断「供应商没看」—— 多数客户端根本不回。
 */

describe("发送状态机", () => {
  it("草稿只能进排队,不能直接跳到已发送", () => {
    expect(checkMessageTransition("DRAFT", "QUEUED").ok).toBe(true);
    expect(checkMessageTransition("DRAFT", "SENT").ok).toBe(false);
  });

  it("失败可重新排队;已发送是终态", () => {
    expect(checkMessageTransition("DELIVERY_FAILED", "QUEUED").ok).toBe(true);
    expect(checkMessageTransition("SENT", "QUEUED").ok).toBe(false);
    expect(checkMessageTransition("SENT", "DELIVERY_FAILED").ok).toBe(false);
  });
});

describe("已读结论:三种证据分开,不许互推", () => {
  const base = {
    readReceiptRequested: true,
    readReceiptReceivedAt: null,
    openTrackedAt: null,
    state: "SENT" as const,
  };

  it("**已发送但没收到回执 → UNKNOWN,不是「未读」**", () => {
    expect(concludeRead(base)).toBe("UNKNOWN");
    expect(readConclusionNote("UNKNOWN")).toContain("这不代表对方没看");
    expect(readConclusionNote("UNKNOWN")).toContain("默认不回执");
  });

  it("收到回执才算已读", () => {
    expect(concludeRead({ ...base, readReceiptReceivedAt: "2026-08-12T00:00:00Z" })).toBe("CONFIRMED_READ");
  });

  it("只有追踪像素时是**弱证据**,措辞必须点明局限", () => {
    expect(concludeRead({ ...base, openTrackedAt: "2026-08-12T00:00:00Z" })).toBe("LIKELY_OPENED");
    expect(readConclusionNote("LIKELY_OPENED")).toContain("弱证据");
    expect(readConclusionNote("LIKELY_OPENED")).toContain("预览窗格");
  });

  it("回执优先于追踪像素", () => {
    expect(
      concludeRead({ ...base, readReceiptReceivedAt: "2026-08-12T00:00:00Z", openTrackedAt: "2026-08-12T00:00:00Z" }),
    ).toBe("CONFIRMED_READ");
  });

  it("**没发出去就谈不上已读**", () => {
    for (const state of ["DRAFT", "QUEUED", "DELIVERY_FAILED"] as const) {
      expect(concludeRead({ ...base, state, readReceiptReceivedAt: "2026-08-12T00:00:00Z" })).toBe("NOT_SENT");
    }
  });
});

describe("SMTP 配置解析", () => {
  const full = {
    host: "smtp.example.com",
    port: "465",
    user: "u@example.com",
    password: "secret",
    from: "ezPLM <u@example.com>",
    secure: undefined,
  };

  it("参数齐全时 configured=true,465 默认隐式 TLS", () => {
    const r = resolveSmtpConfig(full);
    expect(r.configured).toBe(true);
    expect(r.secure).toBe(true);
    expect(r.port).toBe(465);
  });

  it("**缺参数逐项列出**,不是笼统一句「未配置」", () => {
    const r = resolveSmtpConfig({ ...full, host: undefined, password: undefined });
    expect(r.configured).toBe(false);
    expect(r.missing).toContain("SMTP_HOST");
    expect(r.missing).toContain("SMTP_PASSWORD");
    expect(r.missing).not.toContain("SMTP_PORT");
  });

  it("**结果里不含密码** —— 配置对象不该带着口令到处走", () => {
    const r = resolveSmtpConfig(full);
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("端口非法时明确指出是端口的问题", () => {
    const r = resolveSmtpConfig({ ...full, port: "abc" });
    expect(r.configured).toBe(false);
    expect(r.missing.join()).toContain("SMTP_PORT");
    expect(r.port).toBeNull();
  });

  it("587 默认非隐式 TLS,显式 secure 可覆盖", () => {
    expect(resolveSmtpConfig({ ...full, port: "587" }).secure).toBe(false);
    expect(resolveSmtpConfig({ ...full, port: "587", secure: "true" }).secure).toBe(true);
  });
});
