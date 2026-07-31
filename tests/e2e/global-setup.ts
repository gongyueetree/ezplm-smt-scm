import { execSync } from "child_process";

/**
 * E2E 前置:库就绪 + migration 应用 + 种子(幂等 upsert,可重复执行)。
 *
 * 起库这一步**只在本地做**:`scripts/dev-db.sh` 走的是 Homebrew postgresql@17,
 * CI(Linux runner)上没有 brew,而且 CI 本来就用服务容器提供 Postgres ——
 * 在那里再去起一个本机库既不可能也没必要。
 * 判据用 `CI` 环境变量(GitHub Actions 等 CI 会自动设置)。
 */
export default function globalSetup() {
  const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });

  if (process.env.CI) {
    console.log("[e2e] CI 环境:数据库由服务容器提供,跳过 scripts/dev-db.sh");
  } else {
    run("bash scripts/dev-db.sh start");
  }

  run("pnpm exec prisma migrate deploy");
  run("pnpm exec prisma db seed");
}
