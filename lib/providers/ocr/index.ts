/**
 * OCR Provider 工厂。
 * 无凭据时**抛错而不是回落到假实现** —— 见 provider.ts 的纪律说明。
 */
import { ClaudeBomOcrProvider } from "./claude";
import { OcrError, ocrProviderMode, type BomOcrProvider } from "./provider";

export function getBomOcrProvider(): BomOcrProvider {
  if (ocrProviderMode() !== "claude") {
    throw new OcrError(
      "图片/PDF 识别不可用:ANTHROPIC_API_KEY 未配置。文件已归档,请人工补录为 CSV/XLSX 后导入。",
      "not_configured",
    );
  }
  return new ClaudeBomOcrProvider();
}

export { ClaudeBomOcrProvider, OCR_MODEL, parseOcrTable } from "./claude";
export { OcrError, ocrProviderMode } from "./provider";
export type { BomOcrProvider, OcrMode, OcrRecognizeInput, OcrRecognizeResult } from "./provider";
