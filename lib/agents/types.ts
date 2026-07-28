/**
 * 智能体公共契约(SPEC §13)。
 *
 * 三条不可破的纪律:
 * 1. **LLM 不产出数值**:AI 只能给"建议参数"(如 Markup 档位、物料分类),
 *    所有金额一律由 lib/domain/* 的确定性函数重算;
 * 2. **读工具可自动执行,写工具必须确认卡片**:写工具的输出先落 AgentApproval(PENDING),
 *    人工批准后才由业务层执行;
 * 3. **AgentRun 记录 SPEC §13 全要素**:输入 / 工具 / 证据 / 模型输出 / 人工确认 /
 *    最终写入结果 / 失败 / token 成本 / 时间。
 */
import { z } from "zod";

export type AgentTypeValue = "RFQ_INTAKE" | "BOM_MATCHING" | "SOURCING" | "QUOTE" | "OPO";

/** 工具种类:决定是否需要人工确认卡片 */
export type ToolKind = "read" | "write";

export interface AgentToolDef<TInput = unknown, TOutput = unknown> {
  name: string;
  kind: ToolKind;
  description: string;
  /** SPEC §13:工具调用必须用 Zod schema */
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
}

export interface AgentEvidenceRecord {
  source: "EZPLM" | "DIGIKEY" | "MOUSER" | "OFFLINE" | null;
  uri: string | null;
  payload: unknown;
}

export interface AgentStepRecord {
  stepNo: number;
  toolName: string | null;
  input: unknown;
  output: unknown;
  status: "SUCCEEDED" | "FAILED";
}

/** 需要人工批准的写操作(确认卡片) */
export interface AgentWriteProposal {
  toolName: string;
  /** 卡片上展示的拟写入内容 */
  payload: unknown;
  /** 人可读的变更说明 */
  summary: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** 成本(美元);未知留 null,不猜 */
  costUsd: string | null;
}

export interface AgentRunResult {
  agentType: AgentTypeValue;
  status: "SUCCEEDED" | "FAILED";
  input: unknown;
  output: unknown;
  steps: AgentStepRecord[];
  evidences: AgentEvidenceRecord[];
  /** 写操作一律以"待确认提案"返回,agent 自身绝不落库 */
  writeProposals: AgentWriteProposal[];
  error: string | null;
  tokenUsage: TokenUsage | null;
  startedAt: string;
  finishedAt: string;
}

/** 模型形态:mock = 本地确定性建议;claude = 真实模型(需 ANTHROPIC_API_KEY) */
export type AgentMode = "mock" | "claude";

export function agentMode(): AgentMode {
  return process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
}
