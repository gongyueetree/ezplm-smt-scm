/**
 * 统一 LLM 接入层 —— 业务代码永不感知具体厂商(与 Provider 层同一套思路)。
 *
 * 支持:Google Gemini(`GEMINI_API_KEY`)/ Anthropic Claude(`ANTHROPIC_API_KEY`)。
 * 选型顺序:显式 `AI_PROVIDER` > Gemini > Anthropic > 无(功能如实降级)。
 *
 * 三条不可破的纪律(CLAUDE.md 硬性约束 2/3/5):
 * 1. **模型不产出金额**:只允许给"建议参数"(物料分类、Markup 档位)与转写文本;
 *    价格、GTB、PPV、总价一律由 lib/domain/* 的确定性函数重算;
 * 2. **写操作只产出提案**,须经人工确认卡片批准;
 * 3. **API Key 仅存服务端环境变量**,绝不进入日志、错误消息或浏览器。
 */
import type { TokenUsage } from "@/lib/agents/types";

export type LlmVendor = "gemini" | "anthropic";

export interface LlmAttachment {
  /** image/png · image/jpeg · image/webp · application/pdf */
  mimeType: string;
  data: Buffer;
}

export interface LlmGenerateInput {
  system?: string;
  prompt: string;
  attachments?: LlmAttachment[];
  maxOutputTokens?: number;
  temperature?: number;
  /** 期望模型直接输出 JSON(各厂商用各自的结构化输出开关) */
  json?: boolean;
  /**
   * 推理预算(仅 Gemini 2.5 系列)。转写这类"照抄"任务传 0 更快更省;
   * 不传则用模型默认值。
   */
  thinkingBudget?: number;
}

export interface LlmGenerateResult {
  text: string;
  usage: TokenUsage | null;
  model: string;
  vendor: LlmVendor;
}

export interface LlmProvider {
  readonly vendor: LlmVendor;
  readonly model: string;
  generateText(input: LlmGenerateInput): Promise<LlmGenerateResult>;
}

export type LlmErrorKind =
  | "not_configured"
  | "api"
  | "too_large"
  | "unsupported_type"
  | "invalid_output";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** 附件大小上限:两家的内联附件都在这个量级,超了不如早说 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const SUPPORTED_ATTACHMENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export function assertAttachmentSupported(a: LlmAttachment): void {
  if (!SUPPORTED_ATTACHMENT_TYPES.has(a.mimeType)) {
    throw new LlmError(`不支持的附件类型:${a.mimeType}`, "unsupported_type");
  }
  if (a.data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new LlmError(
      `附件 ${Math.round(a.data.byteLength / 1024 / 1024)}MB 超过 ${
        MAX_ATTACHMENT_BYTES / 1024 / 1024
      }MB 上限,请拆分后再传`,
      "too_large",
    );
  }
}

/** 当前生效的厂商;都没配返回 null(调用方据此如实降级,**不得伪装已接入**) */
export function llmVendor(): LlmVendor | null {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === "gemini") return process.env.GEMINI_API_KEY ? "gemini" : null;
  if (explicit === "anthropic") return process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
  if (explicit === "none" || explicit === "off") return null;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export const DEFAULT_MODELS: Record<LlmVendor, string> = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-opus-5",
};

export function llmModel(vendor: LlmVendor): string {
  const configured = vendor === "gemini" ? process.env.GEMINI_MODEL : process.env.ANTHROPIC_MODEL;
  return configured?.trim() || DEFAULT_MODELS[vendor];
}

/** 供 UI 诚实展示当前 AI 形态;**不返回任何凭据内容** */
export function llmStatus(): {
  configured: boolean;
  vendor: LlmVendor | null;
  model: string | null;
} {
  const vendor = llmVendor();
  return { configured: vendor !== null, vendor, model: vendor ? llmModel(vendor) : null };
}

/**
 * 从模型输出里取 JSON。
 * 模型偶尔会裹 ```json 代码块或前后带说明;这里做最小容错,
 * 结构不对一律抛错 —— **绝不返回半个对象**。
 */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const objStart = candidate.indexOf("{");
  const arrStart = candidate.indexOf("[");
  const start =
    objStart < 0 ? arrStart : arrStart < 0 ? objStart : Math.min(objStart, arrStart);
  if (start < 0) throw new LlmError("模型输出中找不到 JSON,已放弃(不猜测内容)", "invalid_output");
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (end <= start) throw new LlmError("模型输出的 JSON 不完整,已放弃", "invalid_output");
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new LlmError("模型输出的 JSON 解析失败,已放弃(不猜测内容)", "invalid_output");
  }
}
