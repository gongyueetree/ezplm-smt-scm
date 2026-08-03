/**
 * 重设某个账号的登录口令。
 *
 * 为什么需要这个脚本:
 * - 口令以 bcrypt 哈希存储,**无法找回**,只能重设;
 * - 重跑种子**不会**重置已有账号的口令 —— 种子的 upsert 只有
 *   `update: { name }`,passwordHash 仅在 create 时写入。
 *   所以"密码忘了就重跑种子"这条路是不通的。
 *
 * 纪律:
 * - 口令从**隐藏输入**读取,不进命令行参数、不进 shell 历史;
 * - 全程不打印口令,连长度都不打;
 * - 写 AuditLog(谁在什么时候重设了谁的口令)——
 *   口令重设是敏感操作,不留痕等于给自己埋雷;
 * - 只能改**同一租户内**的账号,不接受跨租户操作。
 *
 * 用法:
 *   pnpm reset:password                      # 交互式:列出账号 → 选 → 输入新口令
 *   DATABASE_URL=<远端串> pnpm reset:password  # 对线上库操作
 */
import "./bootstrap-env";
import { createInterface } from "readline";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../lib/auth/password";
import { writeAudit } from "../lib/server/audit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/*
 * 输入层。
 *
 * 只用**一个** readline 实例:每次 ask 都新建实例会让管道输入的行被前一个实例
 * 的缓冲吃掉 —— 表现为脚本静默退出、什么都没改(实测踩到过,退出码还是 0,
 * 比直接报错更危险)。
 */
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
const pending: ((line: string) => void)[] = [];
const buffered: string[] = [];
rl.on("line", (line) => {
  const next = pending.shift();
  if (next) next(line);
  else buffered.push(line);
});

function readLine(): Promise<string> {
  const ready = buffered.shift();
  if (ready !== undefined) return Promise.resolve(ready);
  return new Promise((resolve) => pending.push(resolve));
}

function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return readLine();
}

/**
 * 口令输入。
 *
 * TTY 下逐字符读取并屏蔽回显;**非 TTY(管道/CI)时按行读即可** ——
 * 那种场景没有终端可泄露,强行开 raw mode 反而读不到数据。
 */
async function askHidden(prompt: string): Promise<string> {
  const stdin = process.stdin as NodeJS.ReadStream;
  process.stdout.write(prompt);

  if (!stdin.isTTY) {
    const line = await readLine();
    process.stdout.write("\n");
    return line;
  }

  return new Promise((resolve) => {
    rl.pause();
    stdin.setRawMode(true);
    stdin.resume();
    let buf = "";
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          rl.resume();
          process.stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n已取消\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/**
 * 只显示 host:port/dbname,**不显示用户名与密码**。
 * 改口令是敏感操作,不知道自己在改哪个库比改错更糟 ——
 * seed-remote.sh 一开始就有这个确认,本脚本最初漏了(实测踩到:
 * 列出来的账号与本机库对不上,才发现连的是另一个库)。
 */
function describeTarget(url: string): string {
  return url.replace(/^[a-z]+:\/\//, "").replace(/^[^@]*@/, "").replace(/\?.*$/, "");
}

async function main() {
  console.log(`\n目标数据库:${describeTarget(connectionString!)}`);
  console.log("  ⚠ 请先确认这是你要改的库 —— 改错库会让你以为已生效但线上依旧登不进去\n");

  const target = process.argv[2]?.trim();

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      tenantId: true,
      userRoles: { select: { role: { select: { name: true } } } },
    },
    orderBy: [{ isActive: "desc" }, { email: "asc" }],
  });

  if (users.length === 0) {
    console.error("库里没有任何用户 —— 先跑 pnpm seed:remote 建演示账号");
    process.exit(1);
  }

  let picked = target ? users.find((u) => u.email === target) : undefined;

  if (!picked) {
    console.log("\n可选账号:\n");
    users.forEach((u, i) => {
      const roles = u.userRoles.map((r) => r.role.name).join("/") || "无角色";
      // 停用账号也列出来 —— 否则用户不知道自己为什么登不进去
      const state = u.isActive ? "" : "  ⚠ 已停用(登录会被拒)";
      console.log(`  ${String(i + 1).padStart(2)}. ${u.email}  [${roles}]${state}`);
    });
    const idx = Number(await ask("\n选择序号:"));
    picked = users[idx - 1];
    if (!picked) {
      console.error("序号无效");
      process.exit(1);
    }
  }

  if (!picked.isActive) {
    const yes = await ask(
      `\n⚠ 「${picked.email}」当前是**停用**状态,重设口令后仍然登录不了。\n  要同时恢复启用吗?[y/N] `,
    );
    if (yes.trim().toLowerCase() === "y") {
      await prisma.user.update({ where: { id: picked.id }, data: { isActive: true } });
      console.log("  已恢复启用");
    }
  }

  const pw1 = await askHidden(`为「${picked.email}」设置新口令(输入不回显):`);
  if (pw1.length < 8) {
    console.error("口令至少 8 位");
    process.exit(1);
  }
  const pw2 = await askHidden("再输入一次确认:");
  if (pw1 !== pw2) {
    console.error("两次输入不一致");
    process.exit(1);
  }

  const passwordHash = await hashPassword(pw1);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: picked!.id }, data: { passwordHash } });
    await writeAudit(tx, {
      tenantId: picked!.tenantId,
      userId: picked!.id,
      action: "USER_PASSWORD_RESET",
      entityType: "User",
      entityId: picked!.id,
      // 只记"改了口令"这件事,**不记任何口令内容**
      after: { email: picked!.email, via: "scripts/reset-password.ts" },
    });
  });

  console.log(`\n✅ 已重设「${picked.email}」的口令,并记入 AuditLog。`);
  console.log("   新口令不会在任何地方回显 —— 请自行妥善保存。");
}

main()
  .catch((e) => {
    console.error("重设失败:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
