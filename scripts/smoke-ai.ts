/**
 * AI 接入冒烟(与 smoke:external 同一套路数)。
 *
 * 用途:配好 Key 之后由**人类**自己跑一次,确认真实联调可用,
 * 并把输出贴回评审记录 —— 在拿到这份输出之前,任何地方都不得声称"已联调"。
 *
 * 纪律:只打印凭据的**长度**,绝不回显任何 Key 内容。
 *
 *   pnpm smoke:ai
 */
import fs from "node:fs";
import path from "node:path";
import { getLlmProvider, llmStatus, LlmError } from "../lib/ai";
import { getBomOcrProvider, ocrProviderMode } from "../lib/providers/ocr";
import { MockQuoteAgent, getQuoteAgent } from "../lib/agents/quote-agent";

function checklist() {
  const rows: [string, string | undefined][] = [
    ["AI_PROVIDER", process.env.AI_PROVIDER],
    ["GEMINI_API_KEY", process.env.GEMINI_API_KEY],
    ["GEMINI_MODEL", process.env.GEMINI_MODEL],
    ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY],
    ["ANTHROPIC_MODEL", process.env.ANTHROPIC_MODEL],
  ];
  console.log("=== 凭据检查清单(只看长度,不回显内容)===");
  for (const [key, value] of rows) {
    const secret = key.endsWith("_API_KEY");
    if (!value) console.log(`  · ${key.padEnd(20)} 未配置`);
    else if (secret) console.log(`  ✓ ${key.padEnd(20)} 已配置(${value.length} 字符)`);
    else console.log(`  ✓ ${key.padEnd(20)} ${value}`);
  }
}

async function main() {
  checklist();

  const status = llmStatus();
  console.log("\n=== 当前生效形态 ===");
  console.log(`  厂商:${status.vendor ?? "未配置"} · 模型:${status.model ?? "-"}`);
  console.log(`  QuoteAgent:${getQuoteAgent().mode}`);
  console.log(`  BOM 图片识别:${ocrProviderMode()}`);

  if (!status.configured) {
    console.log("\n未配置任何模型凭据 —— AI 功能按本地规则降级,页面会如实标注「未接入模型」。");
    console.log("在 .env.local 填入 GEMINI_API_KEY 后重跑本脚本。");
    return;
  }

  // ① 基础连通性 + JSON 输出
  console.log("\n=== ① 连通性与结构化输出 ===");
  const llm = getLlmProvider();
  const ping = await llm.generateText({
    system: "你只输出 JSON,不要解释。",
    prompt: '回复 {"ok": true, "vendor": "<你所属的厂商>"}',
    json: true,
    maxOutputTokens: 2048,
    thinkingBudget: 0,
  });
  console.log(`  ${llm.vendor}/${llm.model} → ${ping.text.replace(/\s+/g, " ").slice(0, 160)}`);
  console.log(
    `  token 用量:prompt ${ping.usage?.promptTokens ?? "-"} / completion ${ping.usage?.completionTokens ?? "-"}`,
  );

  // ② 报价分类建议(AI 只给参数,金额由确定性函数算)
  console.log("\n=== ② QuoteAgent 分类/Markup 建议 ===");
  const agent = getQuoteAgent();
  const run = await agent.run({
    versionId: "smoke",
    currency: "CNY",
    lines: [
      { lineNo: 1, mpn: "RC0603FR-0710KL", manufacturer: "Yageo", description: "RES 10K 1% 0603", qty: 1000, purchaseCost: "0.08" },
      { lineNo: 2, mpn: "STM32F103C8T6", manufacturer: "ST", description: "MCU ARM Cortex-M3", qty: 100, purchaseCost: "20" },
    ],
  });
  const out = run.output as { suggestions: { lineNo: number; materialCategory: string; suggestedMarkupPct: string; confidence: number }[]; repaired?: number };
  for (const s of out.suggestions) {
    console.log(`  行 ${s.lineNo}:${s.materialCategory} · Markup ${s.suggestedMarkupPct} · 置信度 ${s.confidence}`);
  }
  console.log(`  本地规则补齐/修正:${out.repaired ?? 0} 行`);
  console.log(`  写提案数:${run.writeProposals.length}(必须人工确认后才落库)`);

  // 与本地规则对照,佐证"金额不由模型产出"
  const mockRun = await new MockQuoteAgent().run({
    versionId: "smoke",
    currency: "CNY",
    lines: [
      { lineNo: 1, mpn: "RC0603FR-0710KL", manufacturer: "Yageo", description: "RES 10K 1% 0603", qty: 1000, purchaseCost: "0.08" },
      { lineNo: 2, mpn: "STM32F103C8T6", manufacturer: "ST", description: "MCU ARM Cortex-M3", qty: 100, purchaseCost: "20" },
    ],
  });
  const mockPreview = (mockRun.output as { preview: { grandTotal: string } }).preview;
  const llmPreview = (run.output as { preview: { grandTotal: string } }).preview;
  console.log(`  试算总价:模型建议档位 ${llmPreview.grandTotal} / 本地规则档位 ${mockPreview.grandTotal}`);
  console.log("  (两者都由 lib/domain/quote-calc.ts 计算,模型只影响 Markup 档位)");

  // ③ 图片 BOM 转写
  const fixture = path.join(process.cwd(), "tests", "e2e", "fixtures", "demo-bom-scan.png");
  console.log("\n=== ③ 图片 BOM 转写 ===");
  if (!fs.existsSync(fixture)) {
    console.log(`  跳过:未找到夹具 ${fixture}`);
  } else {
    const ocr = getBomOcrProvider();
    const result = await ocr.recognizeTable({
      buffer: fs.readFileSync(fixture),
      mimeType: "image/png",
      fileName: "demo-bom-scan.png",
    });
    console.log(`  ${result.vendor}/${result.model} → ${result.rows.length} 行`);
    for (const row of result.rows) console.log("   ", JSON.stringify(row));
    if (result.note) console.log(`  提示:${result.note}`);
    console.log("  (识别结果是草稿,导入时仍须逐行人工核对)");
  }

  console.log("\n✓ 冒烟完成。把以上输出贴回评审记录后,方可把状态写为「已联调」。");
}

main().catch((e) => {
  if (e instanceof LlmError) {
    console.error(`\n✗ 冒烟失败(${e.kind}):${e.message}`);
  } else {
    console.error("\n✗ 冒烟失败:", e instanceof Error ? e.message : String(e));
  }
  process.exitCode = 1;
});
