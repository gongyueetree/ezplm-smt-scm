import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Dockerfile 的平台兼容护栏。
 *
 * 本项目「一套代码两种交付」:同一份 Dockerfile 既要能在自建主机 docker build,
 * 也要能被 Railway 这类 PaaS 直接构建。踩过的坑必须有测试兜着 ——
 * 这些错误只在**云端构建时**才暴露,本地开发机(无 Docker)完全看不到。
 */
const DOCKERFILE = readFileSync(path.join(__dirname, "..", "..", "Dockerfile"), "utf8");

/** 取出真正的指令行(去掉注释与空行) */
const instructions = DOCKERFILE.split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

describe("Dockerfile:PaaS 兼容性", () => {
  it("**不得出现 VOLUME** —— Railway 拒绝含 VOLUME 的 Dockerfile,构建期直接 invalid", () => {
    const offenders = instructions.filter((l) => /^VOLUME\b/i.test(l));
    expect(offenders).toEqual([]);
  });

  it("存储目录仍被创建并交给非 root 用户(持久化靠部署时挂具名卷,不靠 VOLUME 声明)", () => {
    expect(DOCKERFILE).toMatch(/mkdir -p \/app\/\.storage/);
    expect(DOCKERFILE).toMatch(/chown -R nextjs:nodejs \/app\/\.storage/);
  });

  it("以非 root 运行", () => {
    expect(instructions.some((l) => /^USER\s+nextjs$/i.test(l))).toBe(true);
  });

  it("**运行层 PATH 必须含 /app/node_modules/.bin** —— prisma db seed 会 spawn `tsx`,否则容器内灌种子报 spawn tsx ENOENT", () => {
    const pathEnv = instructions.filter((l) => /^ENV\s+PATH=/i.test(l));
    expect(pathEnv.length).toBeGreaterThan(0);
    expect(pathEnv.join("\n")).toContain("/app/node_modules/.bin");
  });

  it("构建期不连数据库:只 prisma generate,migrate 留给启动脚本", () => {
    expect(DOCKERFILE).toMatch(/prisma generate/);
    expect(DOCKERFILE).not.toMatch(/RUN\s+.*migrate\s+deploy/);
  });
});
