/**
 * LLM 工厂。无凭据时**抛错而不是回落到假实现** ——
 * 调用方据此走本地确定性规则,并在 UI 如实标注"未接入模型"。
 */
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { LlmError, llmVendor, type LlmProvider } from "./provider";

export function getLlmProvider(): LlmProvider {
  const vendor = llmVendor();
  if (vendor === "gemini") return new GeminiProvider();
  if (vendor === "anthropic") return new AnthropicProvider();
  throw new LlmError(
    "未配置任何模型凭据(GEMINI_API_KEY 或 ANTHROPIC_API_KEY),AI 功能按本地规则降级",
    "not_configured",
  );
}

export { AnthropicProvider } from "./anthropic";
export { GeminiProvider } from "./gemini";
export {
  DEFAULT_MODELS,
  LlmError,
  extractJson,
  llmModel,
  llmStatus,
  llmVendor,
  MAX_ATTACHMENT_BYTES,
} from "./provider";
export type {
  LlmAttachment,
  LlmGenerateInput,
  LlmGenerateResult,
  LlmProvider,
  LlmVendor,
} from "./provider";
