/**
 * A-4 回归:重设口令脚本的参数解析与口令来源准入。
 *
 * 两个真实缺陷:
 * 1. `--password Secret12345` 里的口令被当成了要改的邮箱
 *    (原解析只排除以 `--` 开头的项,没有消费标志位的值);
 * 2. 明文口令进 argv 后对**同主机任何用户可见**(/proc/<pid>/cmdline),
 *    而脚本对远端库照跑不误,没有任何阻拦。
 */
import { describe, expect, it } from "vitest";
import {
  checkPasswordSource,
  classifyDbTarget,
  normalizePipedSecret,
  parseResetArgs,
} from "@/scripts/lib/password-input";

describe("parseResetArgs", () => {
  it("**不得把 --password 的值当成邮箱** —— 这是原实现的真实缺陷", () => {
    const r = parseResetArgs(["--password", "Secret12345"]);
    expect(r.target).toBeUndefined();
    expect(r.inlinePassword).toBe("Secret12345");
  });

  it("--domain 的值同样不能落进邮箱位", () => {
    const r = parseResetArgs(["--domain", "demo.qianchuang.cn", "--password", "Secret12345"]);
    expect(r.target).toBeUndefined();
    expect(r.domain).toBe("demo.qianchuang.cn");
  });

  it("邮箱在前、标志位在后时,邮箱仍能正确取到", () => {
    const r = parseResetArgs(["pm@demo.cn", "--password", "Secret12345"]);
    expect(r.target).toBe("pm@demo.cn");
    expect(r.inlinePassword).toBe("Secret12345");
  });

  it("--domain 允许带 @ 前缀", () => {
    expect(parseResetArgs(["--domain", "@demo.cn"]).domain).toBe("demo.cn");
  });

  it("布尔标志位不吞掉后面的值", () => {
    const r = parseResetArgs(["--all", "--password-stdin"]);
    expect(r.all).toBe(true);
    expect(r.passwordStdin).toBe(true);
    expect(r.target).toBeUndefined();
  });

  it("拼错的标志位必须被报出来,不能被当成邮箱静默跑偏", () => {
    // 原实现里 `--pasword` 会被当成标志位忽略,而 `x` 变成邮箱
    const r = parseResetArgs(["--pasword", "x"]);
    expect(r.unknown).toContain("--pasword");
  });

  it("多余的位置参数也要报出来 —— 一次只能改一个账号", () => {
    const r = parseResetArgs(["a@x.cn", "b@x.cn"]);
    expect(r.target).toBe("a@x.cn");
    expect(r.unknown).toContain("b@x.cn");
  });
});

describe("classifyDbTarget", () => {
  it("localhost / 127.0.0.1 / ::1 判为本机", () => {
    expect(classifyDbTarget("postgresql://u:p@localhost:5432/db")).toBe("LOCAL");
    expect(classifyDbTarget("postgresql://u:p@127.0.0.1:5432/db")).toBe("LOCAL");
    expect(classifyDbTarget("postgresql://u:p@[::1]:5432/db")).toBe("LOCAL");
  });

  it("其余主机一律判为远端", () => {
    expect(classifyDbTarget("postgresql://u:p@containers-us-west-1.railway.app:7777/railway")).toBe(
      "REMOTE",
    );
    expect(classifyDbTarget("postgresql://u:p@10.0.0.5:5432/db")).toBe("REMOTE");
  });

  it("**判不出来时当远端** —— 误判成本机会把明文口令送进生产主机的进程列表", () => {
    expect(classifyDbTarget(undefined)).toBe("REMOTE");
    expect(classifyDbTarget("这不是一个 URL")).toBe("REMOTE");
  });
});

describe("checkPasswordSource", () => {
  it("远端库 + 命令行明文 → 拒绝,并给出可用的替代方式", () => {
    const d = checkPasswordSource({ kind: "ARGV", target: "REMOTE", allowInsecure: false });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toContain("cmdline");
      expect(d.reason).toContain("--password-stdin");
      expect(d.reason).toContain("NEW_PASSWORD_FILE");
    }
  });

  it("远端库 + 命令行明文 + 显式认领风险 → 放行,但仍然告警", () => {
    const d = checkPasswordSource({ kind: "ARGV", target: "REMOTE", allowInsecure: true });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.warnings.join(" ")).toContain("shell 历史");
  });

  it("本机库 + 命令行明文 → 放行(演示口令本来就不是秘密),但不静默", () => {
    const d = checkPasswordSource({ kind: "ARGV", target: "LOCAL", allowInsecure: false });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("管道与文件是推荐方式,远端库也不告警", () => {
    for (const kind of ["STDIN", "FILE", "PROMPT"] as const) {
      const d = checkPasswordSource({ kind, target: "REMOTE", allowInsecure: false });
      expect(d.ok).toBe(true);
      if (d.ok) expect(d.warnings).toHaveLength(0);
    }
  });

  it("环境变量介于两者之间:放行但提醒 shell 历史", () => {
    const d = checkPasswordSource({ kind: "ENV", target: "REMOTE", allowInsecure: false });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.warnings.join(" ")).toContain("environ");
  });
});

describe("normalizePipedSecret", () => {
  it("只剥掉结尾的一个换行(echo 与编辑器都会带)", () => {
    expect(normalizePipedSecret("Secret12345\n")).toBe("Secret12345");
    expect(normalizePipedSecret("Secret12345\r\n")).toBe("Secret12345");
    expect(normalizePipedSecret("Secret12345")).toBe("Secret12345");
  });

  it("**口令内部与首尾的空格必须保留** —— 顺手 trim 会让人对不上口令", () => {
    expect(normalizePipedSecret(" a b \n")).toBe(" a b ");
  });

  it("只剥一个换行:多余空行属于输入本身,原样保留以便暴露问题", () => {
    expect(normalizePipedSecret("Secret12345\n\n")).toBe("Secret12345\n");
  });
});
