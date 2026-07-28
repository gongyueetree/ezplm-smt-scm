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
});
