/**
 * Anthropic Claude 接入(REST,不引 SDK)。
 * 与 GeminiProvider 行为同构,业务代码可互换二者。
 */
import {
  assertAttachmentSupported,
  LlmError,
  llmModel,
  type LlmGenerateInput,
  type LlmGenerateResult,
  type LlmProvider,
} from "./provider";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

export class AnthropicProvider implements LlmProvider {
  readonly vendor = "anthropic" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LlmError("Claude 不可用:ANTHROPIC_API_KEY 未配置", "not_configured");
    }
    this.apiKey = apiKey;
    this.model = options.model ?? llmModel("anthropic");
    this.baseUrl = (options.baseUrl ?? process.env.ANTHROPIC_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
  }

  async generateText(input: LlmGenerateInput): Promise<LlmGenerateResult> {
    const content: unknown[] = [];
    for (const a of input.attachments ?? []) {
      assertAttachmentSupported(a);
      const source = { type: "base64" as const, media_type: a.mimeType, data: a.data.toString("base64") };
      content.push(a.mimeType === "application/pdf" ? { type: "document", source } : { type: "image", source });
    }
    content.push({ type: "text", text: input.prompt });

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: input.maxOutputTokens ?? 8192,
        temperature: input.temperature ?? 0,
        ...(input.system ? { system: input.system } : {}),
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      // 只带状态码,不回显响应体
      throw new LlmError(`Claude 返回 HTTP ${res.status}`, "api");
    }

    const body = (await res.json().catch(() => null)) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    } | null;

    const text = (body?.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    if (!text) throw new LlmError("Claude 未返回文本内容", "invalid_output");

    return {
      text,
      model: this.model,
      vendor: "anthropic",
      usage: body?.usage
        ? {
            promptTokens: body.usage.input_tokens ?? 0,
            completionTokens: body.usage.output_tokens ?? 0,
            costUsd: null,
          }
        : null,
    };
  }
}
