/**
 * Google Gemini 接入(REST,不引 SDK —— 依赖越少,国内 Docker 交付越省事)。
 *
 * 凭据只从服务端环境变量读;**错误消息只带状态码,不回显响应体** ——
 * 响应体可能把请求内容(含 Key 所在的请求头以外的上下文)一并回显。
 */
import {
  assertAttachmentSupported,
  LlmError,
  llmModel,
  type LlmGenerateInput,
  type LlmGenerateResult,
  type LlmProvider,
} from "./provider";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  error?: { message?: string; status?: string };
}

export class GeminiProvider implements LlmProvider {
  readonly vendor = "gemini" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new LlmError("Gemini 不可用:GEMINI_API_KEY 未配置", "not_configured");
    }
    this.apiKey = apiKey;
    this.model = options.model ?? llmModel("gemini");
    this.baseUrl = (options.baseUrl ?? process.env.GEMINI_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
  }

  async generateText(input: LlmGenerateInput): Promise<LlmGenerateResult> {
    const parts: GeminiPart[] = [];
    for (const a of input.attachments ?? []) {
      assertAttachmentSupported(a);
      parts.push({ inline_data: { mime_type: a.mimeType, data: a.data.toString("base64") } });
    }
    parts.push({ text: input.prompt });

    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        maxOutputTokens: input.maxOutputTokens ?? 8192,
        temperature: input.temperature ?? 0,
        ...(input.json ? { responseMimeType: "application/json" } : {}),
        // 2.5 系列的"思考"token 计入输出预算;转写类任务传 0 更快更省
        ...(input.thinkingBudget !== undefined
          ? { thinkingConfig: { thinkingBudget: input.thinkingBudget } }
          : {}),
      },
    };
    if (input.system) {
      body.systemInstruction = { parts: [{ text: input.system }] };
    }

    const res = await fetch(`${this.baseUrl}/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
    });

    const payload = (await res.json().catch(() => null)) as GeminiResponse | null;
    if (!res.ok) {
      // 只带厂商给的 status 短码,不带完整响应体
      throw new LlmError(
        `Gemini 返回 HTTP ${res.status}${payload?.error?.status ? `(${payload.error.status})` : ""}`,
        "api",
      );
    }

    const candidate = payload?.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();

    if (!text) {
      // 常见成因:maxOutputTokens 被"思考"吃光,或触发安全过滤 —— 如实说明,不返回空串冒充结果
      throw new LlmError(
        `Gemini 未返回文本内容(finishReason=${candidate?.finishReason ?? "unknown"});` +
          `若为 MAX_TOKENS,请调大 maxOutputTokens 或把 thinkingBudget 设为 0`,
        "invalid_output",
      );
    }

    const u = payload?.usageMetadata;
    return {
      text,
      model: this.model,
      vendor: "gemini",
      usage: u
        ? {
            promptTokens: u.promptTokenCount ?? 0,
            // 思考 token 也算输出,一并计入才不会低报用量
            completionTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
            costUsd: null, // 单价随合同变化,不猜
          }
        : null,
    };
  }
}
