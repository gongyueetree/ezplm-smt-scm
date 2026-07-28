/**
 * DigiKey Provider 工厂:凭据齐备走真实 API,否则 Mock。
 * 业务代码不感知差异;providerMode 供 UI 诚实展示数据源形态。
 */
import type { ApiUsageRecorder } from "../common/api-usage";
import type { DistributorProvider } from "../common/distributor";
import { DigiKeyProvider } from "./provider";
import { MockDigiKeyProvider } from "./mock";

export function digiKeyMode(): "mock" | "http" {
  return process.env.DIGIKEY_CLIENT_ID && process.env.DIGIKEY_CLIENT_SECRET ? "http" : "mock";
}

let cached: DistributorProvider | undefined;
let cachedMode: "mock" | "http" | undefined;

export function getDigiKeyProvider(opts: { usageRecorder?: ApiUsageRecorder } = {}): DistributorProvider {
  const mode = digiKeyMode();
  if (cached && cachedMode === mode && !opts.usageRecorder) return cached;
  const provider =
    mode === "http"
      ? new DigiKeyProvider({
          clientId: process.env.DIGIKEY_CLIENT_ID!,
          clientSecret: process.env.DIGIKEY_CLIENT_SECRET!,
          accountId: process.env.DIGIKEY_ACCOUNT_ID,
          site: process.env.DIGIKEY_SITE,
          language: process.env.DIGIKEY_LANGUAGE,
          currency: process.env.DIGIKEY_CURRENCY,
          baseUrl: process.env.DIGIKEY_API_BASE_URL,
          usageRecorder: opts.usageRecorder,
        })
      : new MockDigiKeyProvider();
  if (!opts.usageRecorder) {
    cached = provider;
    cachedMode = mode;
  }
  return provider;
}

export { DigiKeyProvider, DIGIKEY_DEFAULT_BASE_URL } from "./provider";
export { MockDigiKeyProvider, MOCK_DIGIKEY_OFFERS } from "./mock";
export { DigiKeyAuthService, DigiKeyTokenStore } from "./auth";
