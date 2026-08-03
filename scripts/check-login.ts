/**
 * 登录诊断:回答"为什么登不进去"。
 *
 * 登录接口对所有失败一律返回「邮箱或密码不正确」(这是对的 —— 不能让人靠错误信息
 * 枚举账号)。但排查时就分不清三件事:账号不存在 / 账号被停用 / 密码不对。
 * 本脚本在**服务端**把这三种情况分开。
 *
 * 为什么要单独成脚本:早先用一行内联命令做同样的事,
 * 连接串在 shell 里被拆坏(报 `Can't reach database server at base`)。
 * 长命令 + 嵌套引号 + zsh 专有语法本来就不该给人手敲。
 *
 * 用法:
 *   pnpm check:login                                   # 用 .env.local 的库
 *   DATABASE_URL="<公网连接串>" pnpm check:login        # 查线上库
 */
import "./bootstrap-env";
import { createInterface } from "readline";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { verifyPassword } from "../lib/auth/password";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}

/** 只显示 host:port/dbname,不显示用户名与密码 */
function describeTarget(url: string): string {
  return url.replace(/^[a-z]+:\/\//, "").replace(/^[^@]*@/, "").replace(/\?.*$/, "");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
const pending: ((l: string) => void)[] = [];
const buffered: string[] = [];
rl.on("line", (l) => {
  const next = pending.shift();
  if (next) next(l);
  else buffered.push(l);
});
function readLine(): Promise<string> {
  const ready = buffered.shift();
  if (ready !== undefined) return Promise.resolve(ready);
  return new Promise((r) => pending.push(r));
}
function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return readLine();
}

async function main() {
  console.log(`\n目标数据库:${describeTarget(connectionString!)}\n`);

  const email = (process.argv[2] ?? (await ask("要检查的邮箱:"))).trim();
  const password = (await ask("要检查的密码(会明文回显,仅用于排查):")).trim();

  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      email: true,
      isActive: true,
      passwordHash: true,
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });

  console.log("");
  if (!user) {
    console.log(`  ❌ 账号不存在:${email}`);
    const all = await prisma.user.findMany({ select: { email: true }, orderBy: { email: "asc" } });
    console.log(`\n  这个库里实际有 ${all.length} 个账号:`);
    for (const u of all) console.log(`    ${u.email}`);
    console.log("\n  → 登录页的快捷按钮可能填的是库里没有的账号,请手动输入上面列出的地址");
    return;
  }

  console.log(`  账号存在:${user.email}  [${user.userRoles.map((r) => r.role.name).join("/") || "无角色"}]`);
  console.log(`  是否启用:${user.isActive ? "是" : "❌ 否 —— 停用账号即使密码正确也会被拒"}`);

  if (!user.passwordHash) {
    console.log("  ❌ 该账号没有口令哈希(可能是 SSO 账号)—— 无法用口令登录");
    return;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  console.log(`  密码是否匹配:${ok ? "✅ 是" : "❌ 否"}`);

  console.log("");
  if (ok && user.isActive) console.log("  → 凭据没问题。若前端仍 401,请确认登录页连的是同一个库");
  else if (ok && !user.isActive) console.log("  → 密码对但账号停用。用 pnpm reset:password 选中它并恢复启用");
  else console.log("  → 密码不对。用 pnpm reset:password 重设");
}

main()
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("reach database server")) {
      console.error(`\n连不上数据库:${describeTarget(connectionString!)}`);
      console.error("  常见原因:连接串被 shell 拆坏(含特殊字符时要加引号)、或用了内网地址");
      console.error("  Railway 请用 Postgres 服务的 DATABASE_PUBLIC_URL,不是 DATABASE_URL");
    } else {
      console.error("\n检查失败:", msg);
    }
    process.exit(1);
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
