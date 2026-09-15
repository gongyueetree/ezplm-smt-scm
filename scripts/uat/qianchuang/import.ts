/**
 * R4-4:乾创 UAT 包导入 CLI。
 *
 * 用法:
 *   pnpm uat:qianchuang:import <fixture-dir> [--confirm] [--mode STRICT_UAT|DEMO_LENIENT] [--tenant <slug>]
 *
 * 默认 **预览**(解析/校验/对账 + 计划输出,零写库);--confirm 才原子提交(§35)。
 * stdout 只输出聚合统计,零真实数据行(§4)。
 */
import { loadEnvLocal } from "../../load-env";
import { existsSync } from "node:fs";

loadEnvLocal();
import { prisma } from "../../../lib/server/db";
import { buildUatPackagePlan, loadReferenceOverrides } from "../../../lib/integration/erp/uat-package";
import { commitUatPackage } from "../../../lib/server/repositories/uat-import";

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--")) ?? process.env.QIANCHUANG_UAT_FIXTURE_DIR;
  const confirm = args.includes("--confirm");
  const mode = (args[args.indexOf("--mode") + 1] as "STRICT_UAT" | "DEMO_LENIENT" | undefined) ?? undefined;
  const tenantSlug = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "qianchuang";
  if (!dir || !existsSync(dir)) {
    console.error("用法:pnpm uat:qianchuang:import <fixture-dir> [--confirm]");
    process.exit(1);
  }

  const plan = await buildUatPackagePlan(dir, mode === "DEMO_LENIENT" ? "DEMO_LENIENT" : "STRICT_UAT");
  console.log(`datasetVersion: ${plan.datasetVersion}(mode=${plan.mode},profile=${plan.profileId})`);
  console.log("files:", plan.files.map((f) => `${f.role}=${f.rows}`).join(" "));
  console.log("issues:", JSON.stringify(plan.issueCounts));
  console.log("reconciliation:", JSON.stringify(plan.reconciliation, null, 2));
  if (!plan.admissible) {
    console.error("整包拒绝(§35):");
    for (const r of plan.rejectReasons) console.error(" -", r);
    process.exit(2);
  }
  if (!confirm) {
    console.log("\n预览通过(admissible)。加 --confirm 原子提交。");
    return;
  }

  const tenant = await prisma.tenant.findFirst({ where: { slug: tenantSlug } });
  if (!tenant) {
    console.error(`租户 slug=${tenantSlug} 不存在 —— 先建租户再导入(不自动建)`);
    process.exit(1);
  }
  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!admin) {
    console.error("租户无用户,无法记审计责任人");
    process.exit(1);
  }
  const session = { tenantId: tenant.id, userId: admin.id, roles: ["MANAGEMENT"] } as const;
  const overrides = loadReferenceOverrides(dir);
  const result = await commitUatPackage(session as never, plan, overrides);
  if (!result.ok) {
    console.error("导入拒绝:", result.reason);
    process.exit(2);
  }
  console.log("已原子提交:", result.datasetVersion);
  console.log("counts:", JSON.stringify(result.counts, null, 2));
}

void main().finally(() => prisma.$disconnect().catch(() => {}));
