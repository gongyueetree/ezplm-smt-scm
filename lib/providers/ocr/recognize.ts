/**
 * 图片 / 扫描件 PDF → 表格行(模型转写)。
 * 厂商由 lib/ai 决定;本文件只负责提示词与**输出护栏**。
 */
import { extractJson, getLlmProvider, LlmError } from "@/lib/ai";
import {
  OcrError,
  OcrTableSchema,
  ocrProviderMode,
  type BomOcrProvider,
  type OcrMode,
  type OcrRecognizeInput,
  type OcrRecognizeResult,
} from "./provider";

const SYSTEM = "你是把 BOM(物料清单)表格逐字转写成结构化数据的工具。只转写,不解释,不计算。";

const PROMPT = [
  "把图中的 BOM 表格逐字转写成 JSON。",
  "",
  "规则:",
  "1. 只转写图上真实存在的字符。看不清的单元格写空字符串,**绝对不要猜测或补全**型号、数量。",
  "2. 不要做任何计算、单位换算、汇总或排序。合计行如果存在就照抄,不要自己算。",
  "3. 保持原有行列结构:第一行是表头,之后每行一条物料;每行元素个数与表头一致,缺格用空字符串占位。",
  "4. 跨页重复的表头照常输出,系统会自己去重。",
  '5. 只输出 JSON:{"rows": [["位号","型号","用量"], ["C1","GRM188R71H104KA93D","100"]]}',
].join("\n");

export class LlmBomOcrProvider implements BomOcrProvider {
  readonly mode: OcrMode;

  constructor() {
    const mode = ocrProviderMode();
    if (mode === "unavailable") {
      throw new OcrError(
        "图片/PDF 识别不可用:未配置 GEMINI_API_KEY 或 ANTHROPIC_API_KEY。文件已归档,请人工补录为 CSV/XLSX 后导入。",
        "not_configured",
      );
    }
    this.mode = mode;
  }

  async recognizeTable(input: OcrRecognizeInput): Promise<OcrRecognizeResult> {
    const llm = getLlmProvider();
    try {
      const res = await llm.generateText({
        system: SYSTEM,
        prompt: PROMPT,
        attachments: [{ mimeType: input.mimeType, data: input.buffer }],
        json: true,
        maxOutputTokens: 16384,
        // 逐字转写不需要推理预算,给 0 更快更省(仅 Gemini 生效)
        thinkingBudget: 0,
      });
      return { ...parseOcrTable(res.text), model: res.model, vendor: res.vendor };
    } catch (e) {
      if (e instanceof OcrError) throw e;
      if (e instanceof LlmError) throw new OcrError(e.message, e.kind);
      throw new OcrError(e instanceof Error ? e.message : String(e), "api");
    }
  }
}

/**
 * 解析模型输出。
 * 结构不对就报错,**绝不返回半张表** —— 半张表会被当成"这份 BOM 就这么多行"。
 */
export function parseOcrTable(raw: string): { rows: string[][]; note: string | null } {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (e) {
    throw new OcrError(
      e instanceof LlmError ? e.message : "识别结果不是 JSON,已放弃(不猜测内容)",
      "invalid_output",
    );
  }

  const check = OcrTableSchema.safeParse(parsed);
  if (!check.success) {
    throw new OcrError("识别结果结构不符合预期(应为 {rows: string[][]}),已放弃", "invalid_output");
  }

  const rows = check.data.rows
    .map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim()))
    .filter((r) => r.some((c) => c !== ""));

  if (rows.length < 2) {
    throw new OcrError("识别结果不足两行(至少需要表头 + 一条物料),已放弃", "invalid_output");
  }

  // 列数对不齐时补空占位,不截断 —— 截断会静默丢数据
  const width = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => (r.length === width ? r : [...r, ...Array(width - r.length).fill("")]));
  const ragged = rows.some((r) => r.length !== width);

  return {
    rows: padded,
    note: ragged ? "部分行的列数与表头不一致,已补空占位,请逐行核对" : null,
  };
}
