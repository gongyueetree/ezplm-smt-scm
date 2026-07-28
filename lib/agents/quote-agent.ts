/**
 * QuoteAgent(SPEC §13)。
 *
 * 职责边界(CLAUDE.md 硬性约束 2/3):
 * - 只产出**建议**:物料分类、Markup 档位建议、风险提示;
 * - **绝不产出金额**:总价/单价/PPV 一律由 lib/domain/quote-calc.ts 重算;
 * - 建议落地为"写提案",必须经人工确认卡片批准后才写库。
 *
 * ⚠ 状态:MockQuoteAgent 已可用;ClaudeQuoteAgent 需 ANTHROPIC_API_KEY,
 * 无 Key 时构造即抛结构化错误,**不伪造已接通模型**。
 */
import { z } from "zod";
import { summarizeQuote, type QuoteLineForCalc } from "@/lib/domain/quote-calc";
import type {
  AgentEvidenceRecord,
  AgentRunResult,
  AgentStepRecord,
  AgentToolDef,
  AgentWriteProposal,
} from "./types";

// ============================================================
// 工具定义(SPEC §13:Zod schema)
// ============================================================

export const QuoteLineInputSchema = z.object({
  lineNo: z.number().int().positive(),
  mpn: z.string().nullable(),
  manufacturer: z.string().nullable(),
  description: z.string().nullable(),
  qty: z.number().nonnegative(),
  purchaseCost: z.string().nullable(),
});
export type QuoteAgentLine = z.infer<typeof QuoteLineInputSchema>;

export const SuggestCategoryOutputSchema = z.object({
  lineNo: z.number().int(),
  /** 建议的物料类别;人工确认后才生效 */
  materialCategory: z.string(),
  /** 建议的 Markup(小数);数值仍由确定性函数用它去算价 */
  suggestedMarkupPct: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});
export type CategorySuggestion = z.infer<typeof SuggestCategoryOutputSchema>;

/** 读工具:分析行并给分类/Markup 建议(可自动执行) */
export const suggestCategoriesTool: AgentToolDef<
  { lines: QuoteAgentLine[] },
  { suggestions: CategorySuggestion[] }
> = {
  name: "suggest_categories",
  kind: "read",
  description: "根据 MPN/描述建议物料类别与 Markup 档位(仅建议,人工确认后生效)",
  inputSchema: z.object({ lines: z.array(QuoteLineInputSchema) }),
  outputSchema: z.object({ suggestions: z.array(SuggestCategoryOutputSchema) }),
};

/** 写工具:把建议应用到报价行 —— 必须经确认卡片 */
export const applySuggestionsTool: AgentToolDef<
  { versionId: string; suggestions: CategorySuggestion[] },
  { applied: number }
> = {
  name: "apply_category_suggestions",
  kind: "write",
  description: "将分类与 Markup 建议写入报价行(写工具:必须人工确认)",
  inputSchema: z.object({
    versionId: z.string(),
    suggestions: z.array(SuggestCategoryOutputSchema),
  }),
  outputSchema: z.object({ applied: z.number().int() }),
};

export const QUOTE_AGENT_TOOLS = [suggestCategoriesTool, applySuggestionsTool];

// ============================================================
// Agent 接口
// ============================================================

export interface QuoteAgentInput {
  versionId: string;
  currency: string;
  lines: QuoteAgentLine[];
}

export interface QuoteAgent {
  readonly mode: "mock" | "claude";
  run(input: QuoteAgentInput): Promise<AgentRunResult>;
}

// ============================================================
// 物料分类规则(Mock 的确定性依据)
// ============================================================

/** 分类 → 建议 Markup 档位。档位值为示例,正式档位由业务维护 */
const CATEGORY_MARKUP: Record<string, string> = {
  阻容感: "0.15",
  IC: "0.08",
  连接器: "0.12",
  结构件: "0.18",
  其它: "0.1",
};

/** 由描述/MPN 归类;无法判断一律"其它"并降低置信度(不猜) */
export function classifyLine(line: QuoteAgentLine): { category: string; confidence: number } {
  const text = `${line.mpn ?? ""} ${line.description ?? ""}`.toUpperCase();
  if (/\b(RES|CAP|IND|RESISTOR|CAPACITOR|电阻|电容|电感)\b/.test(text)) {
    return { category: "阻容感", confidence: 0.9 };
  }
  if (/\b(MCU|IC|AMP|REGULATOR|TRANSCEIVER|收发器|芯片)\b/.test(text)) {
    return { category: "IC", confidence: 0.85 };
  }
  if (/\b(CONN|CONNECTOR|HEADER|连接器|排针)\b/.test(text)) {
    return { category: "连接器", confidence: 0.85 };
  }
  if (/\b(SCREW|BRACKET|外壳|螺丝|结构)\b/.test(text)) {
    return { category: "结构件", confidence: 0.8 };
  }
  return { category: "其它", confidence: 0.4 };
}

// ============================================================
// MockQuoteAgent(无 Key 时的确定性实现)
// ============================================================

export class MockQuoteAgent implements QuoteAgent {
  readonly mode = "mock" as const;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async run(input: QuoteAgentInput): Promise<AgentRunResult> {
    const startedAt = this.now().toISOString();
    const steps: AgentStepRecord[] = [];
    const evidences: AgentEvidenceRecord[] = [];

    // 步骤 1:读工具 —— 自动执行,不需要确认
    const suggestions: CategorySuggestion[] = input.lines.map((l) => {
      const { category, confidence } = classifyLine(l);
      return {
        lineNo: l.lineNo,
        materialCategory: category,
        suggestedMarkupPct: CATEGORY_MARKUP[category] ?? CATEGORY_MARKUP["其它"],
        rationale: `按 MPN/描述归类为「${category}」,采用该类别的 Markup 档位`,
        confidence,
      };
    });
    steps.push({
      stepNo: 1,
      toolName: suggestCategoriesTool.name,
      input: { lines: input.lines.length },
      output: { suggestions: suggestions.length },
      status: "SUCCEEDED",
    });
    evidences.push({
      source: null,
      uri: null,
      payload: { rule: "本地分类规则表", categories: Object.keys(CATEGORY_MARKUP) },
    });

    // 步骤 2:用建议参数**由确定性函数**重算,给人工看影响面(仍不落库)
    const calcLines: QuoteLineForCalc[] = input.lines.map((l) => {
      const s = suggestions.find((x) => x.lineNo === l.lineNo)!;
      return {
        lineNo: l.lineNo,
        category: "MATERIAL",
        qty: l.qty,
        purchaseCost: l.purchaseCost,
        markupPct: s.suggestedMarkupPct,
      };
    });
    const preview = summarizeQuote(calcLines, { currency: input.currency });
    steps.push({
      stepNo: 2,
      toolName: null,
      input: { note: "以建议 Markup 由确定性函数试算(AI 不产出金额)" },
      output: { materialTotal: preview.byCategory.MATERIAL, grandTotal: preview.grandTotal },
      status: "SUCCEEDED",
    });

    // 步骤 3:写操作只产出提案,等人工确认
    const writeProposals: AgentWriteProposal[] = [
      {
        toolName: applySuggestionsTool.name,
        payload: { versionId: input.versionId, suggestions },
        summary:
          `拟为 ${suggestions.length} 行写入物料分类与 Markup 建议;` +
          `按此试算材料小计 ${input.currency} ${preview.byCategory.MATERIAL}。` +
          `分类仍需逐行人工确认后方可提交审批。`,
      },
    ];

    return {
      agentType: "QUOTE",
      status: "SUCCEEDED",
      input,
      output: { suggestions, preview },
      steps,
      evidences,
      writeProposals,
      error: null,
      // Mock 不消耗 token;不编造成本数字
      tokenUsage: null,
      startedAt,
      finishedAt: this.now().toISOString(),
    };
  }
}

// ============================================================
// ClaudeQuoteAgent(待联调)
// ============================================================

/**
 * 真实模型实现 —— 状态:**待联调**。
 * 需 ANTHROPIC_API_KEY(仅服务端环境变量);无 Key 时构造即抛错,
 * 绝不静默回落到 Mock 并对外声称"已接入模型"。
 */
export class ClaudeQuoteAgent implements QuoteAgent {
  readonly mode = "claude" as const;

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ClaudeQuoteAgent 不可用:ANTHROPIC_API_KEY 未配置(状态:待联调)。" +
          "未配置时系统使用 MockQuoteAgent,页面会如实标注为本地规则建议。",
      );
    }
  }

  async run(_input: QuoteAgentInput): Promise<AgentRunResult> {
    void _input;
    // 待联调:接入 Vercel AI SDK + Claude 后在此实现;
    // 实现时必须保持:工具用 Zod schema、写工具只产出提案、金额一律由确定性函数重算。
    throw new Error("ClaudeQuoteAgent 尚未接入真实模型(状态:待联调)");
  }
}

export function getQuoteAgent(): QuoteAgent {
  return process.env.ANTHROPIC_API_KEY ? new ClaudeQuoteAgent() : new MockQuoteAgent();
}
