/**
 * OCR Provider 工厂。
 * 无凭据时**抛错而不是回落到假实现** —— 见 provider.ts 的纪律说明。
 */
import { LlmBomOcrProvider } from "./recognize";
import { OcrError, ocrProviderMode, type BomOcrProvider } from "./provider";

export function getBomOcrProvider(): BomOcrProvider {
  if (ocrProviderMode() === "unavailable") {
    throw new OcrError(
      "图片/PDF 识别不可用:未配置 GEMINI_API_KEY 或 ANTHROPIC_API_KEY。文件已归档,请人工补录为 CSV/XLSX 后导入。",
      "not_configured",
    );
  }
  return new LlmBomOcrProvider();
}

export { LlmBomOcrProvider, parseOcrTable } from "./recognize";
export { OcrError, ocrProviderMode } from "./provider";
export type { BomOcrProvider, OcrMode, OcrRecognizeInput, OcrRecognizeResult } from "./provider";
