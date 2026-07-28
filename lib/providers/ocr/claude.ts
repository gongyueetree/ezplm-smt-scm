/**
 * Claude 视觉转写实现:图片 / 扫描件 PDF → 表格行。
 *
 * 只用 fetch 调 Anthropic Messages API,不引 SDK ——
 * 依赖越少,国内 Docker 交付越省事。
 *
 * 安全纪律:API Key 只从服务端环境变量读,**任何日志与错误消息都不得回显 Key**。
 */
import {
  OcrError,
  OcrTableSchema,
  type BomOcrProvider,
  type OcrRecognizeInput,
  type OcrRecognizeResult,
} from "./provider";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
export const OCR_MODEL = "claude-opus-5";

/** Anthropic 的图片/文档块上限;超过就别发,省得白等一次超时 */
const MAX_BYTES = 5 * 1024 * 1024;

const SUPPORTED_IMAGE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const PROMPT = [
  "你在把一张 BOM(物料清单)表格**逐字转写**成结构化数据。",
  "",
  "规则:",
  "1. 只转写图上真实存在的字符。看不清的单元格写空字符串,**绝对不要猜测或补全**型号、数量。",
  "2. 不要做任何计算、单位换算、汇总或排序。合计行如果存在就照抄,不要自己算。",
  "3. 保持表格原有的行列结构:第一行是表头,之后每行一条物料;每行的元素个数必须与表头一致,缺格用空字符串占位。",
  "4. 跨页重复的表头照常输出,系统会自己去重。",
  "5. 只输出 JSON,形如 {\"rows\": [[\"位号\",\"型号\",\"用量\"], [\"C1\",\"GRM188R71H104KA93D\",\"100\"]]}。不要输出解释文字或 Markdown 代码块。",
].join("\n");

export class ClaudeBomOcrProvider implements BomOcrProvider {
  readonly mode = "claude" as const;

  constructor(private readonly apiKey = process.env.ANTHROPIC_API_KEY) {
    if (!this.apiKey) {
      throw new OcrError(
        "图片/PDF 识别不可用:ANTHROPIC_API_KEY 未配置。文件已归档,请人工补录为 CSV/XLSX 后导入。",
        "not_configured",
      );
    }
  }

  async recognizeTable(input: OcrRecognizeInput): Promise<OcrRecognizeResult> {
    if (input.buffer.byteLength > MAX_BYTES) {
      throw new OcrError(
        `文件 ${Math.round(input.buffer.byteLength / 1024 / 1024)}MB 超过识别上限 5MB,请拆分后再传`,
        "too_large",
      );
    }

    const isPdf = input.mimeType === "application/pdf";
    if (!isPdf && !SUPPORTED_IMAGE.has(input.mimeType)) {
      throw new OcrError(`不支持识别的文件类型:${input.mimeType}`, "unsupported_type");
    }

    const source = {
      type: "base64" as const,
      media_type: input.mimeType,
      data: input.buffer.toString("base64"),
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey!,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: [
              isPdf ? { type: "document", source } : { type: "image", source },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      // 只带状态码,不回显响应体 —— 响应体可能含请求回显
      throw new OcrError(`识别服务返回 HTTP ${res.status}`, "api");
    }

    const body = (await res.json().catch(() => null)) as {
      content?: { type: string; text?: string }[];
    } | null;
    const text = body?.content?.find((c) => c.type === "text")?.text ?? "";
    return { ...parseOcrTable(text), model: OCR_MODEL };
  }
}

/**
 * 解析模型输出。
 * 模型偶尔会裹一层 ```json 代码块或前后带说明文字,这里做最小限度的容错;
 * 结构不对就报错,**绝不返回半张表** —— 半张表会被当成"这份 BOM 就这么多行"。
 */
export function parseOcrTable(raw: string): { rows: string[][]; note: string | null } {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new OcrError("识别结果不是 JSON,已放弃(不猜测内容)", "invalid_output");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new OcrError("识别结果 JSON 解析失败,已放弃(不猜测内容)", "invalid_output");
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
