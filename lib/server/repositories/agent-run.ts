/**
 * AgentRun 落库通道(SPEC §13:AgentRun 记录全要素)。
 * Agent 自身不碰数据库;运行结果由本模块落库,写提案落 AgentApproval(PENDING)。
 */
import type { Prisma } from "@prisma/client";
import type { AgentRunResult } from "@/lib/agents/types";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { SessionRef } from "./rfq";

/** 落库一次 Agent 运行:AgentRun + Step + Evidence + 待确认的 Approval */
export async function persistAgentRun(session: SessionRef, result: AgentRunResult) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.create({
      data: tenantData(session.tenantId, {
        agentType: result.agentType,
        status: result.status,
        userId: session.userId,
        input: result.input as Prisma.InputJsonValue,
        output: (result.output ?? undefined) as Prisma.InputJsonValue | undefined,
        error: result.error,
        tokenUsage: (result.tokenUsage ?? undefined) as Prisma.InputJsonValue | undefined,
        startedAt: new Date(result.startedAt),
        finishedAt: new Date(result.finishedAt),
      }),
    });

    for (const s of result.steps) {
      await tx.agentStep.create({
        data: tenantData(session.tenantId, {
          agentRunId: run.id,
          stepNo: s.stepNo,
          toolName: s.toolName,
          input: (s.input ?? undefined) as Prisma.InputJsonValue | undefined,
          output: (s.output ?? undefined) as Prisma.InputJsonValue | undefined,
          status: s.status,
        }),
      });
    }

    for (const e of result.evidences) {
      await tx.agentEvidence.create({
        data: tenantData(session.tenantId, {
          agentRunId: run.id,
          source: e.source ?? undefined,
          uri: e.uri,
          payload: e.payload as Prisma.InputJsonValue,
        }),
      });
    }

    // 写工具一律先落"待确认卡片",绝不直接写业务表
    for (const p of result.writeProposals) {
      await tx.agentApproval.create({
        data: tenantData(session.tenantId, {
          agentRunId: run.id,
          toolName: p.toolName,
          payload: { summary: p.summary, payload: p.payload } as Prisma.InputJsonValue,
          status: "PENDING",
        }),
      });
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "AGENT_RUN",
      entityType: "AgentRun",
      entityId: run.id,
      after: {
        agentType: result.agentType,
        status: result.status,
        steps: result.steps.length,
        pendingApprovals: result.writeProposals.length,
      },
    });

    return run;
  });
}

export async function getAgentRun(session: SessionRef, runId: string) {
  return prisma.agentRun.findFirst({
    where: tenantWhere(session.tenantId, { id: runId }),
    include: {
      steps: { orderBy: { stepNo: "asc" } },
      evidences: true,
      approvals: { orderBy: { createdAt: "asc" } },
    },
  });
}

/** 人工对确认卡片作出决定;批准后由调用方执行实际写入 */
export async function decideAgentApproval(
  session: SessionRef,
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
) {
  const approval = await prisma.agentApproval.findFirst({
    where: tenantWhere(session.tenantId, { id: approvalId }),
  });
  if (!approval) return null;
  if (approval.status !== "PENDING") {
    return { alreadyDecided: true, approval };
  }

  await prisma.$transaction(async (tx) => {
    await tx.agentApproval.updateMany({
      where: tenantWhere(session.tenantId, { id: approvalId }),
      data: { status: decision, decidedById: session.userId, decidedAt: new Date() },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: decision === "APPROVED" ? "AGENT_WRITE_APPROVE" : "AGENT_WRITE_REJECT",
      entityType: "AgentApproval",
      entityId: approvalId,
      before: { status: "PENDING" },
      after: { status: decision, toolName: approval.toolName },
    });
  });

  return { alreadyDecided: false, approval };
}
