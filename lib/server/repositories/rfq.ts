/**
 * RFQ 数据访问(SPEC §5)。
 * 纪律(CLAUDE.md 数据访问约定):
 * - 所有查询/写入经 tenantWhere / tenantData 守卫,禁止裸拼 where;
 * - 每个写操作在同一事务内写 AuditLog;
 * - 状态流转的合法性由 lib/domain/rfq-status.ts 判定,本层只负责落库与留痕。
 */
import type { Prisma } from "@prisma/client";
import { checkTransition, type RfqStatusValue } from "@/lib/domain/rfq-status";
import type { RoleName } from "@/lib/routes";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export interface SessionRef {
  tenantId: string;
  userId: string;
  roles: RoleName[];
}

/**
 * RFQ 编号:RFQ-YYYYMMDD-NNN,按租户当日序号递增。
 * 取「当前最大序号 + 1」而非 count+1 —— count 在有删除时会重复;
 * 并发下仍可能撞号,由 createRfq 捕获唯一约束冲突后重试(见下)。
 */
export async function nextRfqCode(tenantId: string, now: Date): Promise<string> {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const prefix = `RFQ-${y}${m}${d}-`;
  const last = await prisma.rFQ.findFirst({
    where: tenantWhere(tenantId, { code: { startsWith: prefix } }),
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const lastSeq = last ? Number(last.code.slice(prefix.length)) : 0;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

/** Prisma 唯一约束冲突 */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export interface CreateRfqInput {
  customerId: string;
  title: string;
  quoteQtys?: number[];
  dueAt?: Date | null;
}

/** 并发创建时编号可能撞车,重试至多 5 次(每次重新取号) */
export async function createRfq(session: SessionRef, input: CreateRfqInput) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await createRfqOnce(session, input);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

async function createRfqOnce(session: SessionRef, input: CreateRfqInput) {
  const code = await nextRfqCode(session.tenantId, new Date());
  return prisma.$transaction(async (tx) => {
    const rfq = await tx.rFQ.create({
      data: tenantData(session.tenantId, {
        code,
        customerId: input.customerId,
        title: input.title,
        status: "DRAFT",
        quoteQtys: (input.quoteQtys ?? []) as Prisma.InputJsonValue,
        dueAt: input.dueAt ?? null,
        createdById: session.userId,
      }),
    });
    await tx.rFQStatusHistory.create({
      data: tenantData(session.tenantId, {
        rfqId: rfq.id,
        fromStatus: null,
        toStatus: "DRAFT" as const,
        note: "创建 RFQ",
        changedById: session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "RFQ_CREATE",
      entityType: "RFQ",
      entityId: rfq.id,
      after: { code: rfq.code, title: rfq.title, status: rfq.status },
    });
    return rfq;
  });
}

export async function listRfqs(session: SessionRef) {
  return prisma.rFQ.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { attachments: true, boms: true } },
    },
  });
}

export async function getRfq(session: SessionRef, rfqId: string) {
  return prisma.rFQ.findFirst({
    where: tenantWhere(session.tenantId, { id: rfqId }),
    include: {
      attachments: { orderBy: { createdAt: "asc" } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      boms: { include: { versions: { orderBy: { versionNo: "desc" }, take: 1 } } },
    },
  });
}

export type TransitionOutcome =
  | { ok: true; status: RfqStatusValue }
  | { ok: false; code: string; message: string };

/** 状态流转:先经领域函数校验,再在事务内落库 + 写历史 + 写 AuditLog */
export async function transitionRfqStatus(
  session: SessionRef,
  rfqId: string,
  to: RfqStatusValue,
  reason?: string | null,
): Promise<TransitionOutcome> {
  const rfq = await prisma.rFQ.findFirst({
    where: tenantWhere(session.tenantId, { id: rfqId }),
    select: { id: true, status: true, code: true },
  });
  if (!rfq) return { ok: false, code: "not_found", message: "RFQ 不存在或不属于当前租户" };

  const check = checkTransition({
    from: rfq.status as RfqStatusValue,
    to,
    roles: session.roles,
    reason,
  });
  if (!check.ok) return { ok: false, code: check.code, message: check.message };

  await prisma.$transaction(async (tx) => {
    // update 必须 tenant scoped(CLAUDE.md 硬性约束 4):用 updateMany + 复合条件
    await tx.rFQ.updateMany({
      where: tenantWhere(session.tenantId, { id: rfqId }),
      data: {
        status: to,
        ...(to === "CLOSED_NO_QUOTE" ? { closedReason: reason ?? null } : {}),
      },
    });
    await tx.rFQStatusHistory.create({
      data: tenantData(session.tenantId, {
        rfqId,
        fromStatus: rfq.status,
        toStatus: to,
        note: reason ?? null,
        changedById: session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: to === "CLOSED_NO_QUOTE" ? "RFQ_CLOSE_NO_QUOTE" : "RFQ_STATUS_CHANGE",
      entityType: "RFQ",
      entityId: rfqId,
      before: { status: rfq.status },
      after: { status: to, reason: reason ?? null },
    });
  });

  return { ok: true, status: to };
}

export interface AddAttachmentInput {
  rfqId: string;
  type: "BOM" | "GERBER" | "PDF" | "IMAGE" | "PROCESS_DOC" | "OTHER";
  fileName: string;
  fileKey: string;
  sizeBytes: number;
  contentType: string;
  /** E1b:处理状态。缺省 UPLOADED_NOT_PARSED —— 保存 ≠ 解析 */
  processState?: string;
  processNote?: string | null;
}

/** 附件登记(原始客户文件已由 FileStorageProvider 落盘,此处只记账 + 审计) */
export async function addRfqAttachment(session: SessionRef, input: AddAttachmentInput) {
  const rfq = await prisma.rFQ.findFirst({
    where: tenantWhere(session.tenantId, { id: input.rfqId }),
    select: { id: true },
  });
  if (!rfq) return null;

  return prisma.$transaction(async (tx) => {
    const att = await tx.rFQAttachment.create({
      data: tenantData(session.tenantId, {
        rfqId: input.rfqId,
        type: input.type,
        fileName: input.fileName,
        fileKey: input.fileKey,
        sizeBytes: input.sizeBytes,
        contentType: input.contentType,
        // E1b:上传阶段一律不解析 —— 存下来是一回事,读懂是另一回事
        processState: input.processState ?? "UPLOADED_NOT_PARSED",
        processNote: input.processNote ?? null,
        uploadedById: session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "RFQ_ATTACHMENT_ADD",
      entityType: "RFQAttachment",
      entityId: att.id,
      after: {
        rfqId: input.rfqId,
        fileName: input.fileName,
        type: input.type,
        sizeBytes: input.sizeBytes,
        processState: input.processState ?? "UPLOADED_NOT_PARSED",
      },
    });
    return att;
  });
}
