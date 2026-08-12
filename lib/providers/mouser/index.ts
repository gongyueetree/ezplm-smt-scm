/**
 * Mouser Provider 工厂:有 Key 走真实 API,否则 Mock。
 */
import { forceMockProviders } from "@/lib/providers/common/force-mock";
import type { ApiUsageRecorder } from "../common/api-usage";
import type { DistributorProvider } from "../common/distributor";
import { MockMouserProvider } from "./mock";
import { MouserProvider } from "./provider";

export function mouserMode(): "mock" | "http" {
  if (forceMockProviders()) return "mock";
  return process.env.MOUSER_API_KEY ? "http" : "mock";
}

let cached: DistributorProvider | undefined;
let cachedMode: "mock" | "http" | undefined;

export function getMouserProvider(
  opts: { usageRecorder?: ApiUsageRecorder } = {},
): DistributorProvider {
  const mode = mouserMode();
  if (cached && cachedMode === mode && !opts.usageRecorder) return cached;
  const provider =
    mode === "http"
      ? new MouserProvider({
          apiKey: process.env.MOUSER_API_KEY!,
          baseUrl: process.env.MOUSER_API_BASE_URL,
          usageRecorder: opts.usageRecorder,
        })
      : new MockMouserProvider();
  if (!opts.usageRecorder) {
    cached = provider;
    cachedMode = mode;
  }
  return provider;
}

export { MouserProvider, MOUSER_DEFAULT_BASE_URL, MOUSER_MAX_RECORDS } from "./provider";
export { MockMouserProvider, MOCK_MOUSER_OFFERS } from "./mock";
export { MouserRateLimiter } from "./rate-limiter";
