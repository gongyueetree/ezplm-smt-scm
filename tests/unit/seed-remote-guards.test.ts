import { execFileSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * scripts/seed-remote.sh 的输入护栏。
 *
 * 这个脚本会往**远端生产库**写数据,而它的输入全靠人手动粘贴 ——
 * 粘错一次的代价是灌错库或把公网站点配上公开的缺省口令。
 * 全部用 --dry-run 驱动,绝不真的连库。
 */
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "seed-remote.sh");

/** 返回 { code, out };脚本以非 0 退出时不抛异常 */
function run(stdin: string): { code: number; out: string } {
  try {
    const out = execFileSync("sh", [SCRIPT, "--dry-run"], {
      input: stdin,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const GOOD_URL = "postgresql://postgres:secret@yamanote.proxy.rlwy.net:41234/railway";

describe("seed-remote.sh:输入护栏", () => {
  it("合法输入通过,并且**只回显 host:port/dbname**,不泄露用户名与密码", () => {
    const { code, out } = run(`${GOOD_URL}\nStrongPw!2026\n`);
    expect(code).toBe(0);
    expect(out).toContain("yamanote.proxy.rlwy.net:41234/railway");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("postgres:");
  });

  it("**内网地址必须拒绝** —— railway.internal 本机连不上,粘错的人会以为是脚本坏了", () => {
    const { code, out } = run(
      "postgresql://postgres:secret@postgres.railway.internal:5432/railway\n",
    );
    expect(code).not.toBe(0);
    expect(out).toContain("内网");
  });

  it("粘成变量名(而不是值)时给出可操作的提示", () => {
    const { code, out } = run("RAILWAY_PROJECT_NAME\n");
    expect(code).not.toBe(0);
    expect(out).toContain("DATABASE_PUBLIC_URL");
  });

  it("本机库拒绝 —— 灌本地库应该走 pnpm db:seed", () => {
    expect(run("postgresql://postgres@localhost:5433/ezplm_scm_dev\n").code).not.toBe(0);
  });

  it("**口令不得为空、不得是仓库里公开的 demo1234**", () => {
    expect(run(`${GOOD_URL}\n\n`).code).not.toBe(0);
    const { code, out } = run(`${GOOD_URL}\ndemo1234\n`);
    expect(code).not.toBe(0);
    expect(out).toContain("demo1234");
  });
});
