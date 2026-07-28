/**
 * ezPLM Provider 工厂:业务代码永不感知 Mock/Http 差异(融合钉子 1)。
 * EZPLM_API_BASE_URL + EZPLM_API_KEY 齐备 → Http;否则 Mock。
 * providerMode() 供 UI 诚实展示当前数据源形态(禁止暗示已联调)。
 */
import { HttpEzplmProvider } from "./http";
import { MockEzplmProvider } from "./mock";
import type { EzplmPartsProvider } from "./provider";

let cached: EzplmPartsProvider | undefined;
let cachedMode: "mock" | "http" | undefined;

export function ezplmProviderMode(): "mock" | "http" {
  return process.env.EZPLM_API_BASE_URL && process.env.EZPLM_API_KEY ? "http" : "mock";
}

export function getEzplmPartsProvider(): EzplmPartsProvider {
  const mode = ezplmProviderMode();
  if (cached && cachedMode === mode) return cached;
  cached =
    mode === "http"
      ? new HttpEzplmProvider({
          baseUrl: process.env.EZPLM_API_BASE_URL!,
          apiKey: process.env.EZPLM_API_KEY!,
        })
      : new MockEzplmProvider();
  cachedMode = mode;
  return cached;
}

export { MockEzplmProvider } from "./mock";
export { HttpEzplmProvider } from "./http";
export { EZPLM_PATHS } from "./api-types";
export type { EzplmApiPart, EzplmReferenceDesign } from "./api-types";
export { ProviderError } from "./provider";
export type { EzplmPartsProvider } from "./provider";
export * from "./types";
