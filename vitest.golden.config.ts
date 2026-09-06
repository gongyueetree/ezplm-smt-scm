import { defineConfig } from "vitest/config";
import path from "path";

/**
 * F5:golden 套件独立配置。
 *
 * 与 `pnpm test`(tests/unit)分开跑,原因有二:
 * 1. golden 是**合并门禁**(KICKOFF:任何一条不平衡即阻断)—— CI 里单列一步,
 *    红了能一眼看出是"数据完整性回归",而不是淹在 1400 个单测里;
 * 2. `pnpm test:golden` 可独立执行,改解析器的人跑它最快。
 *
 * >10MB 的重载用例默认不跑,GOLDEN_SLOW=1 才启用(CI 时间预算;
 * 同场景的 HTTP 全链路已由 tests/e2e/zz-e9 在每次 CI 覆盖)。
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/golden/**/*.test.ts"],
    // 17000 行级别的解析在慢机上可能超过默认 5s
    testTimeout: 120_000,
  },
});
