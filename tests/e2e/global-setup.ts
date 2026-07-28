import { execSync } from "child_process";

/** E2E 前置:本地库就绪 + migration 应用 + 种子(幂等 upsert,可重复执行) */
export default function globalSetup() {
  const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });
  run("bash scripts/dev-db.sh start");
  run("pnpm exec prisma migrate deploy");
  run("pnpm exec prisma db seed");
}
