import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * R4:乾创私有 UAT 套件(真实客户数据,永不进普通 CI)。
 * 运行:QIANCHUANG_UAT_FIXTURE_DIR=<dir> pnpm test:uat:qianchuang
 * env 未配置时套件必须 FAIL(不是 skip)—— 专用命令跑不了就要喊出来。
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["tests/uat/qianchuang/**/*.test.ts", "tests/uat/qianchuang/**/*.uat.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
