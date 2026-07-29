/**
 * BOM 图片/扫描件识别 Provider(SPEC 二期能力,应客户要求提前交付)。
 *
 * 严守 CLAUDE.md 的 AI 纪律:
 * - 模型只做**转写**(把图上的表格抄成行列),**不做任何数值计算**;
 *   数量、单价等一律由既有确定性函数(parseQty / Decimal)重新解析;
 * - 输出是**草稿**,必须走与 CSV/XLSX 完全相同的列映射 + 校验 + 人工确认链路,
 *   不得直接落库成正式 BOM 行;
 * - 无凭据时**不回落到任何"假装识别"的实现** —— 明确报"未配置",
 *   由 UI 如实告诉用户"该文件已归档,需人工补录"。
 *
 * 厂商无关:走 lib/ai 的统一接入层,Gemini / Claude 都能用。
 */
import { z } from "zod";
import { llmVendor, type LlmVendor } from "@/lib/ai";

/** 当前识别形态;unavailable = 未配置任何模型凭据 */
export type OcrMode = LlmVendor | "unavailable";

export const OcrTableSchema = z.object({
  rows: z.array(z.array(z.string())),
});

export interface OcrRecognizeInput {
  buffer: Buffer;
  /** image/png · image/jpeg · application/pdf */
  mimeType: string;
  fileName: string;
}

export interface OcrRecognizeResult {
  rows: string[][];
  /** 模型自报的完整度提示;仅供 UI 提示强度,不作为放行依据 */
  note: string | null;
  model: string;
  vendor: LlmVendor;
}

export class OcrError extends Error {
  constructor(
    message: string,
    readonly kind: "not_configured" | "unsupported_type" | "too_large" | "api" | "invalid_output",
  ) {
    super(message);
    this.name = "OcrError";
  }
}

export interface BomOcrProvider {
  readonly mode: OcrMode;
  recognizeTable(input: OcrRecognizeInput): Promise<OcrRecognizeResult>;
}

export function ocrProviderMode(): OcrMode {
  return llmVendor() ?? "unavailable";
}
