/**
 * AuditLog 写入通道(CLAUDE.md 硬性约束 4)。
 * 所有写操作经本通道记录 tenantId/userId/action/entityType/entityId/before/after。
 * db 参数接受 PrismaClient 或事务客户端(与业务写操作同事务)。
 */
import type { Prisma } from "@prisma/client";

export interface AuditInput {
  tenantId: string;
  userId: string;
  /** 动作,统一 大写下划线,如 AUTH_LOGIN / RFQ_CREATE / QUOTE_SUBMIT */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** 最小可写入接口(PrismaClient / TransactionClient 均满足) */
export interface AuditWriter {
  auditLog: {
    create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown>;
  };
}

export function buildAuditRecord(input: AuditInput): Prisma.AuditLogUncheckedCreateInput {
  const { tenantId, userId, action, entityType, entityId } = input;
  if (!tenantId || !userId) throw new Error("AuditLog 必须携带 tenantId 与 userId");
  if (!action || !entityType || !entityId) throw new Error("AuditLog 必须携带 action/entityType/entityId");
  return {
    tenantId,
    userId,
    action,
    entityType,
    entityId,
    before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
    after: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
  };
}

export async function writeAudit(db: AuditWriter, input: AuditInput): Promise<void> {
  await db.auditLog.create({ data: buildAuditRecord(input) });
}
