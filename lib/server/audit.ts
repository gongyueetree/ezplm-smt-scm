/**
 * AuditLog 写入通道(CLAUDE.md 硬性约束 4)。
 * 所有写操作经本通道记录 tenantId/userId/action/entityType/entityId/before/after。
 * db 参数接受 PrismaClient 或事务客户端(与业务写操作同事务)。
 */
import type { ActorType, Prisma } from "@prisma/client";

export interface AuditInput {
  tenantId: string;
  /**
   * 关联内部责任人(外部主体操作时 = 邀请人/链接创建人等内部负责人)。
   * R3-1 起**实际操作者看 actorType/actorId/actorDisplay** —— 修正门户登录、
   * 供应商公开响应、系统 worker 把外部动作记在内部 userId 名下的归因污染。
   */
  userId: string;
  /** 实际操作主体类型;缺省 = INTERNAL_USER(即 userId 本人操作) */
  actorType?: ActorType;
  /** 实际操作主体 id(PORTAL_ACCOUNT=门户账号 id;SUPPLIER_LINK=请求 id;SYSTEM=进程标识) */
  actorId?: string;
  /** 人读的操作者标识(门户邮箱、供应商自述姓名)。展示用,禁止放凭据/token/密码 */
  actorDisplay?: string;
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

export class AuditRedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditRedactionError";
  }
}

/**
 * R3-8(P1-6 收尾):审计载荷红线 —— 凭据性数据**永不入审计日志**。
 * 键名黑名单(大小写不敏感,深度扫描):password/passwordHash/secret/
 * apiKey/accessToken/authorization/bearer/tokenHash。
 * token 痕迹只允许 tokenRef(hash 前 8 位,见 tokenAuditRef)。
 * 命中即抛错:宁可写库失败暴露问题,不可静默把凭据沉进 append-only 日志。
 */
const FORBIDDEN_KEY = /^(password|passwordhash|secret|apikey|accesstoken|authorization|bearer|tokenhash)$/i;

function assertRedacted(value: unknown, path: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertRedacted(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(k)) {
      throw new AuditRedactionError(`审计载荷禁止携带凭据性键:${path}.${k}(token 痕迹只允许 tokenRef)`);
    }
    assertRedacted(v, `${path}.${k}`);
  }
}

export function buildAuditRecord(input: AuditInput): Prisma.AuditLogUncheckedCreateInput {
  const { tenantId, userId, action, entityType, entityId } = input;
  if (!tenantId || !userId) throw new Error("AuditLog 必须携带 tenantId 与 userId");
  if (!action || !entityType || !entityId) throw new Error("AuditLog 必须携带 action/entityType/entityId");
  if ((input.actorType === "PORTAL_ACCOUNT" || input.actorType === "SUPPLIER_LINK") && !input.actorId) {
    throw new Error("外部主体审计必须携带 actorId(账号/请求 id)");
  }
  assertRedacted(input.before, "before");
  assertRedacted(input.after, "after");
  return {
    tenantId,
    userId,
    actorType: input.actorType ?? "INTERNAL_USER",
    actorId: input.actorId ?? (input.actorType ? null : userId),
    actorDisplay: input.actorDisplay ?? null,
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
