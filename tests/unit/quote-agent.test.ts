import { describe, expect, it } from "vitest";
import {
  LlmQuoteAgent,
  reconcileSuggestions,
  MockQuoteAgent,
  QUOTE_AGENT_TOOLS,
  applySuggestionsTool,
  classifyLine,
  getQuoteAgent,
  suggestCategoriesTool,
} from "@/lib/agents/quote-agent";

const LINES = [
  { lineNo: 1, mpn: "RC0603FR-0710KL", manufacturer: "Yageo", description: "RES 10K 1% 0603", qty: 1000, purchaseCost: "0.08" },
  { lineNo: 2, mpn: "STM32F103C8T6", manufacturer: "ST", description: "MCU ARM Cortex-M3", qty: 100, purchaseCost: "20" },
  { lineNo: 3, mpn: "XX-UNKNOWN", manufacturer: null, description: "无法识别的东西", qty: 10, purchaseCost: "1" },
];

describe("QuoteAgent 工具契约(SPEC §13)", () => {
  it("工具都用 Zod schema 定义,并区分读/写", () => {
    expect(QUOTE_AGENT_TOOLS.length).toBeGreaterThan(0);
    for (const t of QUOTE_AGENT_TOOLS) {
      expect(typeof t.inputSchema.parse).toBe("function");
      expect(typeof t.outputSchema.parse).toBe("function");
      expect(["read", "write"]).toContain(t.kind);
    }
    expect(suggestCategoriesTool.kind).toBe("read");
    expect(applySuggestionsTool.kind).toBe("write");
  });

  it("输入不符合 schema 时被 Zod 拒绝", () => {
    expect(() => suggestCategoriesTool.inputSchema.parse({ lines: [{ lineNo: 0 }] })).toThrow();
  });
});

describe("物料分类规则(确定性,不猜)", () => {
  it("按 MPN/描述归类", () => {
    expect(classifyLine(LINES[0]).category).toBe("阻容感");
    expect(classifyLine(LINES[1]).category).toBe("IC");
  });

  it("无法识别时归「其它」并显著降低置信度(不假装认识)", () => {
    const r = classifyLine(LINES[2]);
    expect(r.category).toBe("其它");
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("相同输入恒得相同结果(可复现)", () => {
    expect(classifyLine(LINES[0])).toEqual(classifyLine(LINES[0]));
  });
});

describe("MockQuoteAgent 运行(AI 只建议,不落库、不出金额)", () => {
  const agent = new MockQuoteAgent(() => new Date("2026-07-27T10:00:00.000Z"));

  it("记录 SPEC §13 全要素", async () => {
    const r = await agent.run({ versionId: "v1", currency: "CNY", lines: LINES });
    expect(r.agentType).toBe("QUOTE");
    expect(r.status).toBe("SUCCEEDED");
    expect(r.input).toBeTruthy();
    expect(r.output).toBeTruthy();
    expect(r.steps.length).toBeGreaterThanOrEqual(2);
    expect(r.evidences.length).toBeGreaterThan(0);
    expect(r.startedAt).toBe("2026-07-27T10:00:00.000Z");
    expect(r.finishedAt).toBeTruthy();
  });

  it("写操作只产出待确认提案,agent 自身不落库", async () => {
    const r = await agent.run({ versionId: "v1", currency: "CNY", lines: LINES });
    expect(r.writeProposals).toHaveLength(1);
    expect(r.writeProposals[0].toolName).toBe(applySuggestionsTool.name);
    expect(r.writeProposals[0].summary).toContain("人工确认");
  });

  it("给出的是建议参数(分类 + Markup),金额由确定性函数试算", async () => {
    const r = await agent.run({ versionId: "v1", currency: "CNY", lines: LINES });
    const out = r.output as { suggestions: { lineNo: number; suggestedMarkupPct: string }[]; preview: { byCategory: Record<string, string> } };
    expect(out.suggestions).toHaveLength(3);
    // 阻容感 15% → 1000 × 0.08 × 1.15 = 92;IC 8% → 100 × 20 × 1.08 = 2160;其它 10% → 10 × 1 × 1.1 = 11
    expect(out.preview.byCategory.MATERIAL).toBe("2263.00");
  });

  it("Mock 不编造 token 成本", async () => {
    const r = await agent.run({ versionId: "v1", currency: "CNY", lines: LINES });
    expect(r.tokenUsage).toBeNull();
  });

  it("空报价不报错", async () => {
    const r = await agent.run({ versionId: "v1", currency: "CNY", lines: [] });
    expect(r.status).toBe("SUCCEEDED");
    expect((r.output as { suggestions: unknown[] }).suggestions).toEqual([]);
  });
});

describe("LlmQuoteAgent:无 Key 时不伪装已接通", () => {
  const KEYS = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AI_PROVIDER"] as const;

  function withoutKeys(fn: () => void) {
    const saved = KEYS.map((k) => [k, process.env[k]] as const);
    for (const k of KEYS) delete process.env[k];
    try {
      fn();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it("未配置任何模型凭据时构造即抛结构化错误", () => {
    withoutKeys(() => {
      expect(() => new LlmQuoteAgent()).toThrow(/GEMINI_API_KEY 或 ANTHROPIC_API_KEY/);
    });
  });

  it("无 Key 时工厂回落到 Mock,并以 mode 字段如实标注", () => {
    withoutKeys(() => {
      expect(getQuoteAgent().mode).toBe("mock");
    });
  });

  it("配置 GEMINI_API_KEY 后工厂给出 gemini 形态", () => {
    withoutKeys(() => {
      process.env.GEMINI_API_KEY = "test-key-not-real";
      expect(getQuoteAgent().mode).toBe("gemini");
    });
  });
});

describe("reconcileSuggestions:模型输出对齐(AI 只给参数,且参数必须可信)", () => {
  it("模型漏行时用本地规则补齐,绝不静默丢行", () => {
    const { suggestions, repaired } = reconcileSuggestions(LINES, [
      { lineNo: 1, materialCategory: "阻容感", suggestedMarkupPct: "0.15", rationale: "电阻", confidence: 0.9 },
    ]);
    expect(suggestions).toHaveLength(3);
    expect(repaired).toBe(2);
    expect(suggestions[1].rationale).toContain("模型未返回该行");
    // 补齐的行置信度必须被压低,不能冒充可信建议
    expect(suggestions[1].confidence).toBeLessThanOrEqual(0.4);
  });

  it("Markup 不是合法小数字符串时回落到类别档位并压低置信度", () => {
    const { suggestions, repaired } = reconcileSuggestions([LINES[0]], [
      { lineNo: 1, materialCategory: "IC", suggestedMarkupPct: "百分之十五", rationale: "", confidence: 0.95 },
    ]);
    expect(repaired).toBe(1);
    expect(suggestions[0].suggestedMarkupPct).toBe("0.08"); // IC 档位
    expect(suggestions[0].confidence).toBeLessThanOrEqual(0.3);
  });

  it("Markup 超出 0–1 区间时同样回落 —— 防止模型把 15% 写成 15", () => {
    const { suggestions } = reconcileSuggestions([LINES[0]], [
      { lineNo: 1, materialCategory: "阻容感", suggestedMarkupPct: "15", rationale: "", confidence: 0.9 },
    ]);
    expect(suggestions[0].suggestedMarkupPct).toBe("0.15");
    expect(suggestions[0].rationale).toContain("不合规");
  });

  it("模型多给的行号被丢弃,不会凭空多出报价行", () => {
    const { suggestions } = reconcileSuggestions([LINES[0]], [
      { lineNo: 1, materialCategory: "阻容感", suggestedMarkupPct: "0.15", rationale: "", confidence: 0.9 },
      { lineNo: 99, materialCategory: "IC", suggestedMarkupPct: "0.08", rationale: "", confidence: 0.9 },
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].lineNo).toBe(1);
  });

  it("合法输出原样保留", () => {
    const { suggestions, repaired } = reconcileSuggestions([LINES[1]], [
      { lineNo: 2, materialCategory: "IC", suggestedMarkupPct: "0.09", rationale: "MCU", confidence: 0.88 },
    ]);
    expect(repaired).toBe(0);
    expect(suggestions[0]).toMatchObject({ materialCategory: "IC", suggestedMarkupPct: "0.09" });
  });
});
