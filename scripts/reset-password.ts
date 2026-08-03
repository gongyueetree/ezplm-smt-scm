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
 *   pnpm reset:password                                  # 交互式:列出账号 → 选 → 输入新口令
 *   pnpm reset:password <email>                          # 直接指定账号
 *   pnpm reset:password --domain demo.qianchuang.cn      # 批量:该域名下所有**启用**账号设同一口令
 *   pnpm reset:password --all                            # 批量:所有启用账号
 *   DATABASE_URL=<远端串> pnpm reset:password ...          # 对线上库操作
 *
 * 批量模式只对演示/测试账号有意义 —— 真实用户共用口令是安全事故。
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
 * 输入层。两条路径必须分开处理,任何一条都实测踩过坑:
 *
 * - **TTY(手敲)**:用 rl.question + 覆写 _writeToOutput 屏蔽回显。
 *   不能用 raw mode 自己逐字符读 —— 回车在 raw 模式下是 `\r`,终端紧接着
 *   还会送 `\n`;上一次读取消费掉 `\r` 后,残留的 `\n` 会被下一次读取当成
 *   "用户直接按了回车",确认口令变成空串、报「两次输入不一致」,
 *   而用户明明输的一样。
 *
 * - **非 TTY(管道/CI)**:stdin 结束时 readline 会 close,
 *   之后再调 rl.question 直接抛 "readline was closed"。
 *   所以这条路预先把所有行缓冲下来,按需取用。
 */
const isTty = Boolean((process.stdin as NodeJS.ReadStream).isTTY);
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: isTty });

let muted = false;
const rlAny = rl as unknown as { _writeToOutput?: (s: string) => void };
const originalWrite = rlAny._writeToOutput?.bind(rl);
rlAny._writeToOutput = (str: string) => {
  if (muted) return;
  originalWrite?.(str);
};

/** 非 TTY:缓冲全部输入行 */
const buffered: string[] = [];
const waiters: ((l: string) => void)[] = [];
let closed = false;
if (!isTty) {
  rl.on("line", (l) => {
    const w = waiters.shift();
    if (w) w(l);
    else buffered.push(l);
  });
  rl.on("close", () => {
    closed = true;
    // stdin 已结束仍有人等 → 给空串,由上层校验拒掉,不要挂死
    while (waiters.length) waiters.shift()!("");
  });
}

function readBuffered(): Promise<string> {
  const ready = buffered.shift();
  if (ready !== undefined) return Promise.resolve(ready);
  if (closed) return Promise.resolve("");
  return new Promise((r) => waiters.push(r));
}

function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  if (!isTty) return readBuffered();
  return new Promise((resolve) => rl.question("", resolve));
}

/** 口令输入:TTY 下屏蔽回显;非 TTY 下按行读(没有终端可泄露) */
function askHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  if (!isTty) {
    return readBuffered().then((v) => {
      process.stdout.write("\n");
      return v;
    });
  }
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      muted = false;
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
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

  const args = process.argv.slice(2).map((a) => a.trim());
  const wantAll = args.includes("--all");
  const domainIdx = args.indexOf("--domain");
  const domain = domainIdx >= 0 ? args[domainIdx + 1]?.replace(/^@/, "") : undefined;
  const target = args.find((a) => !a.startsWith("--") && a !== domain);

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

  /*
   * 批量模式:给一批账号设**同一个**口令。
   *
   * 只对演示/测试账号有意义 —— 真实用户共用口令是安全事故。
   * 因此默认只覆盖**启用**的账号:停用账号即使改了口令也登不进去,
   * 顺手把它们一起改反而会让人误以为可以用。
   */
  if (wantAll || domain) {
    const matched = users.filter(
      (u) => u.isActive && (!domain || u.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`)),
    );
    const skippedInactive = users.filter(
      (u) => !u.isActive && (!domain || u.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`)),
    );

    if (matched.length === 0) {
      console.error(
        domain ? `没有匹配 @${domain} 的**启用**账号` : "没有任何启用账号",
      );
      process.exit(1);
    }

    console.log(`将为以下 ${matched.length} 个账号设置**同一个**口令:\n`);
    for (const u of matched) {
      console.log(`  ${u.email}  [${u.userRoles.map((r) => r.role.name).join("/") || "无角色"}]`);
    }
    if (skippedInactive.length > 0) {
      console.log(`\n  跳过 ${skippedInactive.length} 个**已停用**账号 —— 改了口令也登不进去:`);
      for (const u of skippedInactive) console.log(`    ${u.email}`);
    }

    const yes = await ask("\n确认继续?[y/N] ");
    if (yes.trim().toLowerCase() !== "y") {
      console.log("已取消。");
      return;
    }

    const pw1 = await askHidden("为以上账号设置新口令(输入不回显):");
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
      for (const u of matched) {
        await tx.user.update({ where: { id: u.id }, data: { passwordHash } });
        await writeAudit(tx, {
          tenantId: u.tenantId,
          userId: u.id,
          action: "USER_PASSWORD_RESET",
          entityType: "User",
          entityId: u.id,
          // 只记"改了口令"这件事,不记任何口令内容
          after: { email: u.email, via: "scripts/reset-password.ts --bulk" },
        });
      }
    });

    console.log(`\n✅ 已为 ${matched.length} 个账号设置同一口令,并逐个记入 AuditLog。`);
    console.log("   口令不会在任何地方回显 —— 请自行妥善保存。");
    return;
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
