import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 脚手架(SPEC §17)。PR1 仅提供 Shell/导航冒烟用例;
 * 业务流程用例随对应功能 PR 增补。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  /**
   * 跑生产构建而非 dev server:
   * dev 模式下多 worker 并发首次访问会触发按需编译争用,产生与产品无关的超时;
   * 生产构建同时更接近真实交付形态。本地调试可用 E2E_DEV=1 切回 dev。
   */
  webServer: {
    command: process.env.E2E_DEV ? "pnpm dev" : "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    // 催办接口的鉴权必须在**已配置** CRON_SECRET 的前提下测,
    // 否则它一律 503,测不到"带正确 secret 能过、带错的过不去"
    env: {
      CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret",
      // 自助注册默认关闭;E2E 必须显式打开才测得到注册流程
      ALLOW_SELF_REGISTRATION: "true",
      /*
       * **把外部 Provider 钉在 Mock 上。**
       *
       * E2E 断言的是 Mock 的确定性数据。开发者本地 `.env.local` 若配了真实
       * ezPLM / DigiKey 凭据,同一套用例就会去打真实接口 —— 数据对不上、用例变红,
       * 而没有这些变量的环境却是绿的。「本地红、别处绿」最耗人。
       *
       * 用过空字符串覆盖,不行:Next 把空串当未设置,`.env.local` 的真值会填回来。
       * 所以走显式开关(默认关闭,生产与真实联调不受影响)。
       */
      PROVIDERS_FORCE_MOCK: "1",
    },
    timeout: 300_000,
  },
});
