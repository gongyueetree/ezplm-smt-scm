import { describe, expect, it } from "vitest";
import { buildAuditRecord, writeAudit, type AuditWriter } from "@/lib/server/audit";

describe("AuditLog 写入通道(CLAUDE.md 约束 4)", () => {
  it("记录包含 tenantId/userId/action/entityType/entityId/before/after", () => {
    const rec = buildAuditRecord({
      tenantId: "t1",
      userId: "u1",
      action: "QUOTE_SUBMIT",
      entityType: "QuoteVersion",
      entityId: "qv1",
      before: { status: "DRAFT" },
      after: { status: "PENDING_APPROVAL" },
    });
    expect(rec).toMatchObject({
      tenantId: "t1",
      userId: "u1",
      action: "QUOTE_SUBMIT",
      entityType: "QuoteVersion",
      entityId: "qv1",
      before: { status: "DRAFT" },
      after: { status: "PENDING_APPROVAL" },
    });
  });

  it("缺 tenantId/userId 或缺动作/实体标识时拒绝", () => {
    const base = { action: "A", entityType: "T", entityId: "e1" };
    expect(() => buildAuditRecord({ ...base, tenantId: "", userId: "u1" })).toThrow();
    expect(() => buildAuditRecord({ ...base, tenantId: "t1", userId: "" })).toThrow();
    expect(() =>
      buildAuditRecord({ tenantId: "t1", userId: "u1", action: "", entityType: "T", entityId: "e" }),
    ).toThrow();
  });

  it("writeAudit 经 db.auditLog.create 落库(可接事务客户端)", async () => {
    const calls: unknown[] = [];
    const fakeDb: AuditWriter = {
      auditLog: {
        create: async (args) => {
          calls.push(args.data);
          return {};
        },
      },
    };
    await writeAudit(fakeDb, {
      tenantId: "t1",
      userId: "u1",
      action: "AUTH_LOGIN",
      entityType: "User",
      entityId: "u1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tenantId: "t1", action: "AUTH_LOGIN" });
  });

  // R3-1:外部主体归因
  it("缺省 actorType=INTERNAL_USER 且 actorId=userId(历史语义不变)", () => {
    const rec = buildAuditRecord({
      tenantId: "t1", userId: "u1", action: "A", entityType: "T", entityId: "e1",
    });
    expect(rec).toMatchObject({ actorType: "INTERNAL_USER", actorId: "u1", actorDisplay: null });
  });

  it("外部主体如实归因:PORTAL_ACCOUNT/SUPPLIER_LINK 记 actorId+display,userId 仍为内部责任人", () => {
    const rec = buildAuditRecord({
      tenantId: "t1", userId: "inviter-1",
      actorType: "PORTAL_ACCOUNT", actorId: "pa-1", actorDisplay: "buyer@lianchuang.example",
      action: "PORTAL_LOGIN", entityType: "PortalAccount", entityId: "pa-1",
    });
    expect(rec).toMatchObject({
      userId: "inviter-1", actorType: "PORTAL_ACCOUNT", actorId: "pa-1",
      actorDisplay: "buyer@lianchuang.example",
    });
  });

  it("外部主体缺 actorId 拒绝(禁止把外部动作匿名化)", () => {
    expect(() =>
      buildAuditRecord({
        tenantId: "t1", userId: "u1", actorType: "SUPPLIER_LINK",
        action: "A", entityType: "T", entityId: "e1",
      }),
    ).toThrow();
  });

  it("SYSTEM 主体可无 display(进程标识即 actorId)", () => {
    const rec = buildAuditRecord({
      tenantId: "t1", userId: "system:cron", actorType: "SYSTEM", actorId: "eta-writeback-worker",
      action: "ERP_SYNC_ETA_ATTEMPT", entityType: "IntegrationSyncRecord", entityId: "r1",
    });
    expect(rec).toMatchObject({ actorType: "SYSTEM", actorId: "eta-writeback-worker" });
  });
});
