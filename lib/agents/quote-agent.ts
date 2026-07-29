/**
 * QuoteAgent(SPEC §13)。
 *
 * 职责边界(CLAUDE.md 硬性约束 2/3):
 * - 只产出**建议**:物料分类、Markup 档位建议、风险提示;
 * - **绝不产出金额**:总价/单价/PPV 一律由 lib/domain/quote-calc.ts 重算;
 * - 建议落地为"写提案",必须经人工确认卡片批准后才写库。
 *
 * ⚠ 状态:MockQuoteAgent(本地确定性规则)始终可用;
 * LlmQuoteAgent 需 GEMINI_API_KEY 或 ANTHROPIC_API_KEY,
 * 无 Key 时构造即抛结构化错误,**不伪造已接通模型**。
 */
import { z } from "zod";
import { extractJson, getLlmProvider, llmVendor } from "@/lib/ai";
import { summarizeQuote, type QuoteLineForCalc } from "@/lib/domain/quote-calc";
import type {
  AgentEvidenceRecord,
  AgentMode,
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
  readonly mode: AgentMode;
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
// LlmQuoteAgent(真实模型;Gemini / Claude 通吃)
// ============================================================

/** 允许的 Markup 区间;模型给的档位必须落在这里,否则回落到本地规则档位 */
const MARKUP_MIN = 0;
const MARKUP_MAX = 1;

const AGENT_SYSTEM =
  "你是 SMT 报价的物料分类助手。你只输出物料类别与 Markup 档位建议," +
  "**绝不计算任何金额**(单价、总价、PPV 一律由系统的确定性函数计算)。" +
  "拿不准的行必须给低置信度并归入「其它」,不要猜。";

function buildAgentPrompt(input: QuoteAgentInput): string {
  const catalog = Object.entries(CATEGORY_MARKUP)
    .map(([c, m]) => `${c}(参考 Markup ${m})`)
    .join("、");
  const lines = input.lines.map((l) => ({
    lineNo: l.lineNo,
    mpn: l.mpn,
    manufacturer: l.manufacturer,
    description: l.description,
  }));
  return [
    `可选类别:${catalog}。`,
    "为下列每一行给出物料类别与建议 Markup(0–1 的小数字符串,如 \"0.12\")。",
    "必须为**每一行**都给出结果,行号不得遗漏、不得新增。",
    "rationale 用中文一句话说明依据;confidence 为 0–1 的小数。",
    '只输出 JSON:{"suggestions":[{"lineNo":1,"materialCategory":"IC","suggestedMarkupPct":"0.08","rationale":"...","confidence":0.8}]}',
    "",
    "待分类行:",
    JSON.stringify(lines),
  ].join("\n");
}

const LlmSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      lineNo: z.number().int(),
      materialCategory: z.string().min(1),
      suggestedMarkupPct: z.string(),
      rationale: z.string().default(""),
      confidence: z.number().min(0).max(1).default(0.5),
    }),
  ),
});

/**
 * 把模型输出对齐成"每行一条建议"。
 *
 * 纪律:
 * - 模型漏掉的行**用本地规则补齐**,绝不静默丢行(丢行=这行悄悄没有报价参数);
 * - Markup 非法(非小数字符串 / 超出 0–1)时回落到该类别的本地档位,
 *   并把置信度压到 0.3 —— 参数不合规不能当作可信建议;
 * - 模型多给的行号直接丢弃。
 */
export function reconcileSuggestions(
  lines: QuoteAgentLine[],
  raw: { lineNo: number; materialCategory: string; suggestedMarkupPct: string; rationale: string; confidence: number }[],
): { suggestions: CategorySuggestion[]; repaired: number } {
  const byLine = new Map(raw.map((r) => [r.lineNo, r]));
  let repaired = 0;

  const suggestions = lines.map((l) => {
    const hit = byLine.get(l.lineNo);
    if (!hit) {
      repaired++;
      const { category, confidence } = classifyLine(l);
      return {
        lineNo: l.lineNo,
        materialCategory: category,
        suggestedMarkupPct: CATEGORY_MARKUP[category] ?? CATEGORY_MARKUP["其它"],
        rationale: "模型未返回该行,已用本地规则补齐",
        confidence: Math.min(confidence, 0.4),
      };
    }

    const parsed = Number(hit.suggestedMarkupPct);
    const legal =
      /^\d+(\.\d+)?$/.test(hit.suggestedMarkupPct.trim()) &&
      Number.isFinite(parsed) &&
      parsed >= MARKUP_MIN &&
      parsed <= MARKUP_MAX;
    if (legal) {
      return {
        lineNo: l.lineNo,
        materialCategory: hit.materialCategory,
        suggestedMarkupPct: hit.suggestedMarkupPct.trim(),
        rationale: hit.rationale,
        confidence: hit.confidence,
      };
    }

    repaired++;
    const fallback = CATEGORY_MARKUP[hit.materialCategory] ?? CATEGORY_MARKUP["其它"];
    return {
      lineNo: l.lineNo,
      materialCategory: hit.materialCategory,
      suggestedMarkupPct: fallback,
      rationale: `模型给出的 Markup「${hit.suggestedMarkupPct}」不合规,已回落到该类别档位 ${fallback}`,
      confidence: Math.min(hit.confidence, 0.3),
    };
  });

  return { suggestions, repaired };
}

/**
 * 真实模型实现。厂商由 lib/ai 决定(Gemini / Claude),业务代码不感知差异。
 * 无凭据时构造即抛错,**绝不静默回落到 Mock 并对外声称"已接入模型"**。
 */
export class LlmQuoteAgent implements QuoteAgent {
  readonly mode: Exclude<AgentMode, "mock">;

  constructor(private readonly now: () => Date = () => new Date()) {
    const vendor = llmVendor();
    if (!vendor) {
      throw new Error(
        "LlmQuoteAgent 不可用:未配置 GEMINI_API_KEY 或 ANTHROPIC_API_KEY。" +
          "未配置时系统使用 MockQuoteAgent,页面会如实标注为本地规则建议。",
      );
    }
    this.mode = vendor;
  }

  async run(input: QuoteAgentInput): Promise<AgentRunResult> {
    const startedAt = this.now().toISOString();
    const steps: AgentStepRecord[] = [];
    const evidences: AgentEvidenceRecord[] = [];
    const llm = getLlmProvider();

    let suggestions: CategorySuggestion[];
    let repaired = 0;
    let tokenUsage = null as AgentRunResult["tokenUsage"];

    try {
      const res = await llm.generateText({
        system: AGENT_SYSTEM,
        prompt: buildAgentPrompt(input),
        json: true,
        maxOutputTokens: 8192,
      });
      tokenUsage = res.usage;
      const parsed = LlmSuggestionsSchema.safeParse(extractJson(res.text));
      if (!parsed.success) {
        throw new Error("模型输出结构不符合预期(应为 {suggestions:[...]})");
      }
      const reconciled = reconcileSuggestions(input.lines, parsed.data.suggestions);
      suggestions = reconciled.suggestions;
      repaired = reconciled.repaired;

      steps.push({
        stepNo: 1,
        toolName: suggestCategoriesTool.name,
        input: { lines: input.lines.length, model: res.model, vendor: res.vendor },
        output: { suggestions: suggestions.length, repaired },
        status: "SUCCEEDED",
      });
      evidences.push({
        source: null,
        uri: null,
        payload: { vendor: res.vendor, model: res.model, repairedLines: repaired },
      });
    } catch (e) {
      // 模型不可用/输出不可信:如实记失败步骤,并**回落到本地规则**继续给建议,
      // 而不是让整个报价流程卡死。UI 会显示 repaired 数量。
      const reason = e instanceof Error ? e.message : String(e);
      steps.push({
        stepNo: 1,
        toolName: suggestCategoriesTool.name,
        input: { lines: input.lines.length },
        output: { error: reason },
        status: "FAILED",
      });
      const reconciled = reconcileSuggestions(input.lines, []);
      suggestions = reconciled.suggestions;
      repaired = reconciled.repaired;
      evidences.push({
        source: null,
        uri: null,
        payload: { fallback: "本地分类规则表", reason },
      });
    }

    // 用建议参数**由确定性函数**试算,给人工看影响面(仍不落库)
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

    const writeProposals: AgentWriteProposal[] = [
      {
        toolName: applySuggestionsTool.name,
        payload: { versionId: input.versionId, suggestions },
        summary:
          `拟为 ${suggestions.length} 行写入物料分类与 Markup 建议;` +
          `按此试算材料小计 ${input.currency} ${preview.byCategory.MATERIAL}。` +
          (repaired > 0 ? `其中 ${repaired} 行由本地规则补齐或修正。` : "") +
          `分类仍需逐行人工确认后方可提交审批。`,
      },
    ];

    return {
      agentType: "QUOTE",
      status: "SUCCEEDED",
      input,
      output: { suggestions, preview, repaired },
      steps,
      evidences,
      writeProposals,
      error: null,
      tokenUsage,
      startedAt,
      finishedAt: this.now().toISOString(),
    };
  }
}

export function getQuoteAgent(): QuoteAgent {
  return llmVendor() ? new LlmQuoteAgent() : new MockQuoteAgent();
}
