/**
 * 清空演示环境的业务单据,保留演示基线。
 *
 * 用途:客户测试一段时间后,单据堆积影响下一轮演示。清掉测试期产生的
 * RFQ/BOM/报价/采购/追溯等单据,保留物料、供应商、客户、库存快照、配置与**全部账号**
 * (含自助注册的新账号)—— 清完系统立刻还能用来演示,而不是变成一个空壳。
 *
 * 纪律:
 * - **默认只统计不删**。要真删必须显式加 `--apply`;
 * - 先打印目标库的 host:port/dbname(不含用户名口令),改错库比删错表更糟;
 * - 表分类必须**穷尽**(见 lib/domain/demo-reset-plan.ts)。新增表未分类时**拒绝执行** ——
 *   宁可不跑,也不要留下一张谁都没想起来的表;
 * - 全程 **tenant scoped**:只动指定租户,多租户部署下不会波及别人;
 * - 删除本身写 AuditLog(逐表条数),且审计日志默认保留 ——
 *   先删审计再写审计会让人误以为系统从没被用过;
 * - **必须用 `--as <邮箱>` 声明执行人**。AuditLog 的 userId 不可空,
 *   而脚本没有会话 —— 随手挂到某个管理层账号上等于伪造"是他干的"。
 *   宁可多要一个参数,也不要在审计里写一条不真实的记录。
 *
 * 用法:
 *   pnpm demo:reset                          # 只统计,列出每张表会删多少条
 *   pnpm demo:reset --apply --as <管理员邮箱>  # 真的删(执行人写进审计)
 *   pnpm demo:reset --apply --as <邮箱> --yes            # 非交互(CI/脚本)
 *   pnpm demo:reset --apply --as <邮箱> --include-audit  # 连审计日志一起清
 *   pnpm demo:reset --tenant <slug>          # 指定租户(默认 qianchuang)
 *   DATABASE_URL=<远端串> pnpm demo:reset ...  # 对线上库操作
 */
import "./bootstrap-env";
import { createInterface } from "readline";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  clientKey,
  PURGE_MODELS,
  verifyPlanCoverage,
} from "../lib/domain/demo-reset-plan";
import { writeAudit } from "../lib/server/audit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** 只显示 host:port/dbname,**不显示用户名与口令** */
function describeTarget(url: string): string {
  return url.replace(/^[a-z]+:\/\//, "").replace(/^[^@]*@/, "").replace(/\?.*$/, "");
}

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(prompt, (a) => {
      rl.close();
      resolve(a);
    }),
  );
}

type Delegate = {
  count: (args: { where: { tenantId: string } }) => Promise<number>;
  deleteMany: (args: { where: { tenantId: string } }) => Promise<{ count: number }>;
};

function delegateFor(db: unknown, model: string): Delegate {
  const d = (db as Record<string, unknown>)[clientKey(model)];
  if (!d) throw new Error(`Prisma 客户端上找不到模型 ${model}(clientKey=${clientKey(model)})`);
  return d as Delegate;
}

async function main() {
  const args = process.argv.slice(2).map((a) => a.trim());
  const apply = args.includes("--apply");
  const assumeYes = args.includes("--yes");
  const includeAudit = args.includes("--include-audit");
  const tenantIdx = args.indexOf("--tenant");
  const tenantSlug = tenantIdx >= 0 ? args[tenantIdx + 1] : "qianchuang";
  const asIdx = args.indexOf("--as");
  const asEmail = asIdx >= 0 ? args[asIdx + 1]?.trim().toLowerCase() : undefined;

  const known = new Set(
    ["--apply", "--yes", "--include-audit", "--tenant", tenantSlug, "--as", asEmail].filter(
      (x): x is string => typeof x === "string",
    ),
  );
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    console.error(`无法识别的参数:${unknown.join(" ")}`);
    console.error("可用参数:--apply / --as <邮箱> / --yes / --include-audit / --tenant <slug>");
    process.exit(1);
  }

  console.log(`\n目标数据库:${describeTarget(connectionString!)}`);
  console.log(`目标租户  :${tenantSlug}`);
  console.log(apply ? "模式      :**真删**(--apply)\n" : "模式      :仅统计(加 --apply 才会真删)\n");

  /*
   * 分类穷尽性检查 —— 放在最前面。
   * 新增表未分类时直接拒跑:清库脚本最危险的失败不是删错,
   * 而是漏了一张表却没人知道。
   */
  const actualModels = Prisma.dmmf.datamodel.models.map((m) => m.name);
  const coverage = verifyPlanCoverage(actualModels);
  if (!coverage.ok) {
    console.error("拒绝执行:表分类与 schema 对不上,请先更新 lib/domain/demo-reset-plan.ts");
    if (coverage.unclassified.length) console.error(`  未分类(既没说删也没说留):${coverage.unclassified.join(", ")}`);
    if (coverage.stale.length) console.error(`  名单里有但 schema 已无:${coverage.stale.join(", ")}`);
    if (coverage.conflicting.length) console.error(`  同时出现在两张名单:${coverage.conflicting.join(", ")}`);
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    console.error(`租户 ${tenantSlug} 不存在 —— 用 --tenant <slug> 指定,或先跑种子`);
    process.exit(1);
  }
  const tenantId = tenant.id;

  /*
   * 执行人。只在 --apply 时要求 —— 仅统计不产生审计记录,不必逼人填。
   */
  let operator: { id: string; email: string } | null = null;
  if (apply) {
    if (!asEmail) {
      console.error("拒绝执行:请用 --as <邮箱> 声明执行人 —— 审计记录必须写清是谁清的库");
      console.error("  例:pnpm demo:reset --apply --as management@demo.qianchuang.cn");
      process.exit(1);
    }
    const u = await prisma.user.findFirst({
      where: { tenantId, email: asEmail },
      select: { id: true, email: true },
    });
    if (!u) {
      console.error(`租户 ${tenantSlug} 下没有账号 ${asEmail} —— 执行人必须是本租户的真实账号`);
      process.exit(1);
    }
    operator = u;
    console.log(`执行人  :${u.email}\n`);
  }

  const models = includeAudit ? [...PURGE_MODELS, "AuditLog"] : [...PURGE_MODELS];

  // 先统计。无论删不删都打印这张表 —— 人要先看见会发生什么
  const counts: { model: string; n: number }[] = [];
  for (const m of models) {
    counts.push({ model: m, n: await delegateFor(prisma, m).count({ where: { tenantId } }) });
  }
  const nonEmpty = counts.filter((c) => c.n > 0);
  const total = counts.reduce((s, c) => s + c.n, 0);

  if (nonEmpty.length === 0) {
    console.log("这些表在该租户下已经是空的,无需清理。");
    return;
  }
  console.log("将被清空的表(只列非空的):\n");
  for (const c of nonEmpty) console.log(`  ${c.model.padEnd(28)} ${String(c.n).padStart(7)} 条`);
  console.log(`\n  合计 ${total} 条,涉及 ${nonEmpty.length} 张表`);
  console.log(`\n保留:物料主数据 / 供应商 / 客户 / 库存与在途快照 / 模板与配置 / **全部账号**`);
  console.log(includeAudit ? "  审计日志:一并清空(--include-audit)" : "  审计日志:保留(要清加 --include-audit)");

  if (!apply) {
    console.log("\n这是**仅统计**模式,什么都没删。确认无误后加 --apply 执行。");
    return;
  }

  if (!assumeYes) {
    const yes = await ask(`\n确认清空以上 ${total} 条记录?此操作不可撤销 [输入 yes 继续] `);
    if (yes.trim().toLowerCase() !== "yes") {
      console.log("已取消,未做任何改动。");
      return;
    }
  }

  /*
   * 按 PURGE_MODELS 的顺序(子表在前)逐张删。
   * 不放在单个事务里:94 张表的大事务在远端库上容易超时,
   * 而顺序本身保证了中途失败也不会留下悬挂外键 —— 已删的都是子表。
   */
  const deleted: { model: string; n: number }[] = [];
  for (const m of models) {
    const r = await delegateFor(prisma, m).deleteMany({ where: { tenantId } });
    if (r.count > 0) {
      deleted.push({ model: m, n: r.count });
      console.log(`  已清空 ${m.padEnd(28)} ${String(r.count).padStart(7)} 条`);
    }
  }

  // 清理动作本身要留痕(审计被一起清掉时,这条是重新开始的第一条)
  await writeAudit(prisma, {
    tenantId,
    userId: operator!.id,
    action: "DEMO_DATA_RESET",
    entityType: "Tenant",
    entityId: tenantId,
    after: {
      via: "scripts/reset-demo-data.ts",
      operator: operator!.email,
      includeAudit,
      totalDeleted: deleted.reduce((s, d) => s + d.n, 0),
      tables: deleted.map((d) => `${d.model}:${d.n}`),
    },
  });

  console.log(`\n✅ 已清空 ${deleted.reduce((s, d) => s + d.n, 0)} 条记录,并记入 AuditLog。`);
  console.log("   物料、供应商、客户、库存快照、配置与全部账号均未改动。");
}

main()
  .catch((e) => {
    console.error("清理失败:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
