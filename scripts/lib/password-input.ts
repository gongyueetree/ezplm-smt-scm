/**
 * 重设口令脚本的**参数解析与口令来源策略**(纯函数,可单测)。
 *
 * 抽出来的原因是这两件事都被实测踩到过,而且都不适合靠肉眼看代码保证:
 *
 * 1. 原来的参数解析用 `args.find(a => !a.startsWith("--"))` 找邮箱,
 *    **没有把标志位的值排除掉** —— `--password Secret12345` 里的口令
 *    不以 `--` 开头,于是被当成了要改的邮箱。
 *
 * 2. `--password <口令>` 会把明文放进 **argv**。argv 在 Linux 上是
 *    `/proc/<pid>/cmdline`,**同主机任何用户可读**;还会进 shell 历史。
 *    对本机演示库无所谓(那口令本来就要发给客户),对生产库是事故。
 *    环境变量的暴露面小一档(`/proc/<pid>/environ` 只有属主可读),
 *    但仍会留在 shell 历史里,所以也要提醒。
 */

/** 口令从哪来 —— 暴露面从低到高排列 */
export type PasswordSourceKind =
  | "PROMPT" // 交互式隐藏输入:最安全
  | "STDIN" // --password-stdin:管道,不进 argv 也不进历史
  | "FILE" // NEW_PASSWORD_FILE:文件权限自己管
  | "ENV" // NEW_PASSWORD:/proc/<pid>/environ 属主可读
  | "ARGV"; // --password:/proc/<pid>/cmdline **人人可读**

export interface ParsedArgs {
  /** 单账号模式的邮箱;批量模式为 undefined */
  target?: string;
  domain?: string;
  all: boolean;
  passwordStdin: boolean;
  /** `--password` 的值(明文,**不得打印**) */
  inlinePassword?: string;
  allowInsecureCliPassword: boolean;
  /** 无法识别的参数 —— 拼错的标志位必须报错,不能默默忽略 */
  unknown: string[];
}

/** 需要跟一个值的标志位 */
const VALUE_FLAGS = new Set(["--domain", "--password"]);
/** 不跟值的标志位 */
const BOOL_FLAGS = new Set(["--all", "--password-stdin", "--allow-insecure-cli-password"]);

export function parseResetArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { all: false, passwordStdin: false, allowInsecureCliPassword: false, unknown: [] };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      // 关键:标志位的值在这里被**消费掉**,不会再落进 positional
      const v = argv[i + 1];
      i++;
      if (a === "--domain") out.domain = v?.replace(/^@/, "");
      else out.inlinePassword = v;
      continue;
    }
    if (BOOL_FLAGS.has(a)) {
      if (a === "--all") out.all = true;
      else if (a === "--password-stdin") out.passwordStdin = true;
      else out.allowInsecureCliPassword = true;
      continue;
    }
    // 拼错的标志位(`--pasword`)必须被拒,否则会被当成邮箱静默跑偏
    if (a.startsWith("--")) {
      out.unknown.push(a);
      continue;
    }
    positional.push(a);
  }

  out.target = positional[0];
  if (positional.length > 1) out.unknown.push(...positional.slice(1));
  return out;
}

/* ============================================================
 * 目标库判定
 * ============================================================ */

export type DbTargetKind = "LOCAL" | "REMOTE";

/**
 * 只按主机名判定本机与否。
 *
 * **判不出来一律当远端**(REMOTE)—— 这是唯一安全的默认:
 * 把远端误判成本机会让明文口令直接进生产主机的进程列表,
 * 把本机误判成远端只是多打一个标志位。
 */
export function classifyDbTarget(url: string | undefined): DbTargetKind {
  if (!url) return "REMOTE";
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "REMOTE";
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    return "LOCAL";
  }
  return "REMOTE";
}

/* ============================================================
 * 口令来源准入
 * ============================================================ */

export type SourceDecision =
  | { ok: true; warnings: string[] }
  | { ok: false; reason: string };

/**
 * 判断某个口令来源在当前目标库上是否被允许。
 *
 * 规则只有一条实质内容:**明文进 argv 且目标是远端库 → 拒绝**,
 * 除非操作者显式打上 `--allow-insecure-cli-password` 认领这个风险。
 */
export function checkPasswordSource(input: {
  kind: PasswordSourceKind;
  target: DbTargetKind;
  allowInsecure: boolean;
}): SourceDecision {
  const { kind, target, allowInsecure } = input;

  if (kind === "ARGV") {
    if (target === "REMOTE" && !allowInsecure) {
      return {
        ok: false,
        reason:
          "拒绝执行:`--password <明文>` 会把口令写进进程命令行(Linux 下 /proc/<pid>/cmdline **同主机任何用户可读**)与 shell 历史," +
          "而当前目标是**远端数据库**。\n" +
          "  请改用不经过命令行的方式:\n" +
          "    echo -n '<口令>' | pnpm reset:password --domain <域名> --password-stdin\n" +
          "    NEW_PASSWORD_FILE=/path/to/secret pnpm reset:password --domain <域名>\n" +
          "  确实只是演示账号、且明知口令会被同主机用户看到,再加 --allow-insecure-cli-password。",
      };
    }
    return {
      ok: true,
      warnings: [
        "⚠ 口令来自命令行参数 —— 它已经进了 shell 历史,并在本进程存活期间对同主机用户可见。",
        "  演示账号可以接受;真实用户口令请改用 --password-stdin 或 NEW_PASSWORD_FILE。",
      ],
    };
  }

  if (kind === "ENV") {
    return {
      ok: true,
      warnings: [
        "⚠ 口令来自 NEW_PASSWORD 环境变量 —— 暴露面小于命令行参数(/proc/<pid>/environ 仅属主可读),",
        "  但若是在 shell 里直接赋的值,仍会留在 shell 历史中。",
      ],
    };
  }

  return { ok: true, warnings: [] };
}

/** 来源说明,用于操作回执 —— 让人清楚这次口令是怎么进来的 */
export const SOURCE_LABEL: Record<PasswordSourceKind, string> = {
  PROMPT: "交互式隐藏输入",
  STDIN: "--password-stdin(管道)",
  FILE: "NEW_PASSWORD_FILE(文件)",
  ENV: "NEW_PASSWORD 环境变量",
  ARGV: "--password 命令行参数",
};

/**
 * 从管道/文件读入的口令的收尾处理。
 *
 * 只剥掉**结尾**的一个换行(`echo` 会带、编辑器保存也会带),
 * 其余空白一律保留 —— 口令里的空格是有效字符,顺手 trim 会让
 * "看起来一样的口令"对不上,而这类问题极难排查(本项目在 TTY
 * 的 CRLF 残留上已经踩过一次)。
 */
export function normalizePipedSecret(raw: string): string {
  return raw.replace(/\r?\n$/, "");
}
