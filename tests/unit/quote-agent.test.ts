import { describe, expect, it } from "vitest";
import {
  ClaudeQuoteAgent,
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

describe("ClaudeQuoteAgent:无 Key 时不伪装已接通", () => {
  it("未配置 ANTHROPIC_API_KEY 时构造即抛结构化错误", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new ClaudeQuoteAgent()).toThrow(/待联调/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("无 Key 时工厂回落到 Mock,并以 mode 字段如实标注", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(getQuoteAgent().mode).toBe("mock");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
